<?php
/**
 * amap_api.php — 高德地图 Web 服务 API 代理 v1.0
 *
 * 基于 ClawHub @lbs-amap (GaodeMapOfficial) 发布的 personal-map Skill 自动生成
 * Skill 源: https://clawhub.ai/lbs-amap/skills/personal-map
 * API 文档: https://lbs.amap.com/api/webservice/summary
 *
 * 所有工具调用高德 REST API (https://restapi.amap.com/v3/...)
 * 需要 Web 服务类型 API Key
 */

define('AMAP_REST_BASE', 'https://restapi.amap.com/v3');
define('AMAP_WIA_BASE', 'https://restapi.amap.com');

// ═══ 认证中间件 (复用项目统一认证) ═══
require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';

header('Content-Type: application/json; charset=utf-8');

// ═══ 获取当前用户 ID ═══
// Bearer / 同站 Cookie 优先；legacy query/form 只保留旧客户端兼容。
$authToken = extractSessionToken(true);
$userId = $authToken !== '' ? verifyAuthToken($authToken) : null;

// ═══ 获取 Amap API Key ═══
// 新客户端使用 X-Amap-Key 避免 key 泄漏到访问日志；query/form 为旧客户端兼容。
$apiKey = trim((string)($_SERVER['HTTP_X_AMAP_KEY'] ?? $_GET['amap_key'] ?? $_POST['amap_key'] ?? ''));
if (empty($apiKey)) {
    // 尝试从用户配置读取
    if ($userId) {
        $userConfigFile = __DIR__ . '/../users/user_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId) . '_config.json';
        if (file_exists($userConfigFile)) {
            $userConfig = json_decode(file_get_contents($userConfigFile), true) ?: [];
            $apiKey = $userConfig['amapKey'] ?? '';
        }
    }
}
// 服务器级默认 key (管理员可在 config/amap_config.php 设置)
if (empty($apiKey)) {
    $amapConfigFile = __DIR__ . '/../config/amap_config.php';
    if (file_exists($amapConfigFile)) {
        $amapConfig = require $amapConfigFile;
        $apiKey = $amapConfig['amapKey'] ?? '';
    }
}

// ═══ 辅助函数 ═══
function amap_success($data = null, $extra = []) {
    return array_merge(['success' => true], $extra, $data ?: []);
}

function amap_error($msg, $extra = []) {
    return array_merge(['success' => false, 'error' => $msg], $extra);
}

function amap_get(string $url, array $params = []): array {
    if (!empty($params)) {
        $url .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($params);
    }
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false || $httpCode !== 200) {
        return ['status' => '0', 'info' => "HTTP {$httpCode}: {$err}"];
    }
    $data = json_decode($resp, true);
    return $data ?: ['status' => '0', 'info' => 'JSON 解析失败'];
}

// 高德路径规划结果摘要 (route/data → 便捷字段)
function amap_route_summary(array $route): ?array {
    $path = $route['paths'][0] ?? null;
    if (!$path) return null;
    return [
        'distance' => intval($path['distance'] ?? 0),   // 米
        'duration' => intval($path['duration'] ?? 0),   // 秒
        'strategy' => $path['strategy'] ?? '',
        'tolls' => $path['tolls'] ?? 0,
        'steps' => count($path['steps'] ?? []),
    ];
}

// POI 搜索取 poiId (高德 WIA schema 接口要求 poiId 必填)
function amap_search_poi_id(string $key, string $name, string $lon = '', string $lat = ''): string {
    if (empty($name)) return '';
    $result = amap_get(AMAP_REST_BASE . '/place/text', [
        'key' => $key, 'keywords' => $name, 'offset' => 5, 'page' => 1,
    ]);
    if (($result['status'] ?? '0') !== '1' || empty($result['pois'])) return '';
    // 有坐标时优先选与坐标最接近的 POI
    if ($lon !== '' && $lat !== '') {
        $best = $result['pois'][0];
        $bestDist = PHP_INT_MAX;
        foreach ($result['pois'] as $poi) {
            $loc = explode(',', $poi['location'] ?? '');
            if (count($loc) !== 2) continue;
            // 近似经纬度距离 (1度≈111km)
            $d = (abs(floatval($loc[0]) - floatval($lon)) + abs(floatval($loc[1]) - floatval($lat))) * 111000;
            if ($d < $bestDist) {
                $bestDist = $d;
                $best = $poi;
            }
        }
        return $best['id'] ?? '';
    }
    return $result['pois'][0]['id'] ?? '';
}

// ═══ 路由分派 ═══
$action = $_GET['action'] ?? $_POST['action'] ?? '';

if (empty($apiKey) && $action !== 'config') {
    echo json_encode(amap_error('未配置高德 API Key。请在设置中填写 Amap Web 服务 API Key。获取地址: https://lbs.amap.com/api/webservice/create-project-and-key'));
    exit;
}

switch ($action) {

    // ── 配置检查 ──
    case 'config':
        echo json_encode(amap_success([
            'hasKey' => !empty($apiKey),
            'keyPrefix' => !empty($apiKey) ? substr($apiKey, 0, 8) . '****' : '',
        ]));
        break;

    // ── 1. 地理编码 (地址 → 坐标) ──
    case 'geo': {
        $address = $_GET['address'] ?? $_POST['address'] ?? '';
        $city = $_GET['city'] ?? $_POST['city'] ?? '';
        if (empty($address)) {
            echo json_encode(amap_error('缺少参数: address'));
            break;
        }
        $params = ['key' => $apiKey, 'address' => $address];
        if ($city) $params['city'] = $city;
        $result = amap_get(AMAP_REST_BASE . '/geocode/geo', $params);
        if (($result['status'] ?? '0') === '1' && intval($result['count'] ?? 0) > 0) {
            $geo = $result['geocodes'][0];
            [$lon, $lat] = explode(',', $geo['location']);
            echo json_encode(amap_success([
                'longitude' => floatval($lon),
                'latitude' => floatval($lat),
                'formatted_address' => $geo['formatted_address'] ?? '',
            ]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '无法找到该地址'));
        }
        break;
    }

    // ── 2. 逆地理编码 (坐标 → 地址) ──
    case 'regeocode': {
        $location = $_GET['location'] ?? $_POST['location'] ?? '';
        if (empty($location)) {
            // 也支持分开传 longitude + latitude
            $lon = $_GET['longitude'] ?? $_POST['longitude'] ?? '';
            $lat = $_GET['latitude'] ?? $_POST['latitude'] ?? '';
            if ($lon !== '' && $lat !== '') {
                $location = "{$lon},{$lat}";
            }
        }
        if (empty($location)) {
            echo json_encode(amap_error('缺少参数: location (或 longitude+latitude)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/geocode/regeo', [
            'key' => $apiKey, 'location' => $location,
            'poitype' => '', 'radius' => 1000, 'extensions' => 'base', 'batch' => 'false', 'roadlevel' => 0,
        ]);
        if (($result['status'] ?? '0') === '1' && !empty($result['regeocode'])) {
            $r = $result['regeocode'];
            $ac = $r['addressComponent'] ?? [];
            echo json_encode(amap_success([
                'formatted_address' => $r['formatted_address'] ?? '',
                'country' => $ac['country'] ?? '',
                'province' => $ac['province'] ?? '',
                'city' => $ac['city'] ?? '',
                'district' => $ac['district'] ?? '',
            ]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '逆地理编码失败'));
        }
        break;
    }

    // ── 3. 关键词 POI 搜索 ──
    case 'text_search': {
        $keywords = $_GET['keywords'] ?? $_POST['keywords'] ?? '';
        if (empty($keywords)) {
            echo json_encode(amap_error('缺少参数: keywords'));
            break;
        }
        $city = $_GET['city'] ?? $_POST['city'] ?? '';
        $offset = min(intval($_GET['offset'] ?? $_POST['offset'] ?? 20), 100);
        $params = ['key' => $apiKey, 'keywords' => $keywords, 'offset' => $offset, 'page' => 1];
        if ($city) $params['city'] = $city;
        $result = amap_get(AMAP_REST_BASE . '/place/text', $params);
        if (($result['status'] ?? '0') === '1') {
            $pois = [];
            foreach ($result['pois'] ?? [] as $poi) {
                $loc = $poi['location'] ?? '';
                [$lon, $lat] = $loc ? explode(',', $loc) : ['', ''];
                $pois[] = [
                    'id' => $poi['id'] ?? '',
                    'name' => $poi['name'] ?? '',
                    'longitude' => $lon !== '' ? floatval($lon) : null,
                    'latitude' => $lat !== '' ? floatval($lat) : null,
                    'address' => $poi['address'] ?? '',
                    'tel' => $poi['tel'] ?? '',
                ];
            }
            echo json_encode(amap_success(['pois' => $pois, 'count' => count($pois)]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '搜索失败'));
        }
        break;
    }

    // ── 4. 周边 POI 搜索 ──
    case 'around_search': {
        $location = $_GET['location'] ?? $_POST['location'] ?? '';
        if (empty($location)) {
            echo json_encode(amap_error('缺少参数: location (格式: 经度,纬度)'));
            break;
        }
        $keywords = $_GET['keywords'] ?? $_POST['keywords'] ?? '';
        $radius = intval($_GET['radius'] ?? $_POST['radius'] ?? 1000);
        $types = $_GET['types'] ?? $_POST['types'] ?? '';
        $offset = min(intval($_GET['offset'] ?? $_POST['offset'] ?? 20), 100);
        $page = intval($_GET['page'] ?? $_POST['page'] ?? 1);
        $params = ['key' => $apiKey, 'location' => $location, 'radius' => $radius, 'offset' => $offset, 'page' => $page];
        if ($keywords) $params['keywords'] = $keywords;
        if ($types) $params['types'] = $types;
        $result = amap_get(AMAP_REST_BASE . '/place/around', $params);
        if (($result['status'] ?? '0') === '1') {
            $pois = [];
            foreach ($result['pois'] ?? [] as $poi) {
                $loc = $poi['location'] ?? '';
                [$lon, $lat] = $loc ? explode(',', $loc) : ['', ''];
                $pois[] = [
                    'id' => $poi['id'] ?? '',
                    'name' => $poi['name'] ?? '',
                    'longitude' => $lon !== '' ? floatval($lon) : null,
                    'latitude' => $lat !== '' ? floatval($lat) : null,
                    'address' => $poi['address'] ?? '',
                    'tel' => $poi['tel'] ?? '',
                    'distance' => $poi['distance'] ?? '',
                ];
            }
            echo json_encode(amap_success(['pois' => $pois, 'count' => count($pois)]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '周边搜索失败'));
        }
        break;
    }

    // ── 4b. POI 详情查询 ──
    case 'search_detail': {
        $id = $_GET['id'] ?? $_POST['id'] ?? '';
        if (empty($id)) {
            echo json_encode(amap_error('缺少参数: id (POI ID)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/place/detail', ['key' => $apiKey, 'id' => $id]);
        if (($result['status'] ?? '0') === '1' && !empty($result['pois'])) {
            $poi = $result['pois'][0];
            $loc = $poi['location'] ?? '';
            [$lon, $lat] = $loc ? explode(',', $loc) : ['', ''];
            echo json_encode(amap_success([
                'id' => $poi['id'] ?? '',
                'name' => $poi['name'] ?? '',
                'longitude' => $lon !== '' ? floatval($lon) : null,
                'latitude' => $lat !== '' ? floatval($lat) : null,
                'address' => $poi['address'] ?? '',
                'tel' => $poi['tel'] ?? '',
                'type' => $poi['type'] ?? '',
                'business' => $poi['business'] ?? [],
            ]));
        } else {
            echo json_encode(amap_error($result['info'] ?? 'POI 详情查询失败'));
        }
        break;
    }

    // ── 5. 骑行路线规划 ──
    case 'direction_bicycling': {
        $origin = $_GET['origin'] ?? $_POST['origin'] ?? '';
        $destination = $_GET['destination'] ?? $_POST['destination'] ?? '';
        if (empty($origin) || empty($destination)) {
            echo json_encode(amap_error('缺少参数: origin 和 destination (格式: 经度,纬度)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/direction/bicycling', [
            'key' => $apiKey, 'origin' => $origin, 'destination' => $destination,
        ]);
        if (($result['status'] ?? '0') === '1') {
            // ★ 骑行接口返回 data 字段 (驾车/步行是 route)
            $data = $result['data'] ?? [];
            echo json_encode(amap_success([
                'data' => $data,
                'summary' => amap_route_summary($data),
            ]));
        } else {
            $info = $result['info'] ?? '骑行路径规划失败';
            if ($info === 'SERVICE_NOT_AVAILABLE') {
                $info = '骑行路径规划服务不可用 (需在高德开放平台开通「骑行路径规划」服务, 或该接口当前不可用)';
            }
            echo json_encode(amap_error($info));
        }
        break;
    }

    // ── 6. 距离测量 ──
    case 'distance': {
        $origins = $_GET['origins'] ?? $_POST['origins'] ?? '';
        $destination = $_GET['destination'] ?? $_POST['destination'] ?? '';
        $type = $_GET['type'] ?? $_POST['type'] ?? '1';
        if (empty($origins) || empty($destination)) {
            echo json_encode(amap_error('缺少参数: origins 和 destination'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/distance', [
            'key' => $apiKey, 'origins' => $origins, 'destination' => $destination, 'type' => $type,
        ]);
        if (($result['status'] ?? '0') === '1') {
            echo json_encode(amap_success(['results' => $result['results'] ?? []]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '距离测量失败'));
        }
        break;
    }

    // ── 7. 步行路线规划 ── 编号顺延
    case 'direction_walking': {
        $origin = $_GET['origin'] ?? $_POST['origin'] ?? '';
        $destination = $_GET['destination'] ?? $_POST['destination'] ?? '';
        if (empty($origin) || empty($destination)) {
            echo json_encode(amap_error('缺少参数: origin 和 destination (格式: 经度,纬度)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/direction/walking', [
            'key' => $apiKey, 'origin' => $origin, 'destination' => $destination,
        ]);
        if (($result['status'] ?? '0') === '1') {
            // ★ 步行接口返回 route 单数字段 (原误取 routes 永远为空)
            $route = $result['route'] ?? [];
            echo json_encode(amap_success([
                'data' => $route,
                'summary' => amap_route_summary($route),
            ]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '路径规划失败'));
        }
        break;
    }

    // ── 6. 驾车路线规划 ──
    case 'direction_driving': {
        $origin = $_GET['origin'] ?? $_POST['origin'] ?? '';
        $destination = $_GET['destination'] ?? $_POST['destination'] ?? '';
        if (empty($origin) || empty($destination)) {
            echo json_encode(amap_error('缺少参数: origin 和 destination (格式: 经度,纬度)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/direction/driving', [
            'key' => $apiKey, 'origin' => $origin, 'destination' => $destination,
        ]);
        if (($result['status'] ?? '0') === '1') {
            // ★ 驾车接口返回 route 单数字段 (原误取 routes 永远为空)
            $route = $result['route'] ?? [];
            echo json_encode(amap_success([
                'data' => $route,
                'summary' => amap_route_summary($route),
            ]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '路径规划失败'));
        }
        break;
    }

    // ── 7. 公共交通路线规划 ──
    case 'direction_transit': {
        $origin = $_GET['origin'] ?? $_POST['origin'] ?? '';
        $destination = $_GET['destination'] ?? $_POST['destination'] ?? '';
        $city = $_GET['city'] ?? $_POST['city'] ?? '北京';
        if (empty($origin) || empty($destination)) {
            echo json_encode(amap_error('缺少参数: origin 和 destination (格式: 经度,纬度)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/direction/transit/integrated', [
            'key' => $apiKey, 'origin' => $origin, 'destination' => $destination, 'city' => $city,
        ]);
        if (($result['status'] ?? '0') === '1') {
            echo json_encode(amap_success(['data' => $result]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '公共交通路线规划失败'));
        }
        break;
    }

    // ── 8. IP 定位 ──
    case 'ip_location': {
        $ip = $_GET['ip'] ?? $_POST['ip'] ?? '';
        if (empty($ip)) {
            echo json_encode(amap_error('缺少参数: ip'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/ip', ['key' => $apiKey, 'ip' => $ip]);
        if (($result['status'] ?? '0') === '1') {
            // 高德对无定位数据的 IP (公共 DNS/内网地址等) 返回空数组而非字符串
            $province = $result['province'] ?? '';
            $city = $result['city'] ?? '';
            if (is_array($province) || (empty($province) && is_array($city))) {
                echo json_encode(amap_error('该 IP 无法定位 (高德 IP 库无数据, 公共 DNS/内网地址常见)', [
                    'province' => '', 'city' => '', 'adcode' => '', 'rectangle' => '', 'isp' => '',
                ]));
                break;
            }
            echo json_encode(amap_success([
                'province' => $province,
                'city' => $city,
                'adcode' => $result['adcode'] ?? '',
                'rectangle' => $result['rectangle'] ?? '',
                'isp' => $result['isp'] ?? '',
            ]));
        } else {
            echo json_encode(amap_error($result['info'] ?? 'IP 定位失败'));
        }
        break;
    }

    // ── 9. 天气查询 ──
    case 'weather': {
        $city = $_GET['city'] ?? $_POST['city'] ?? '';
        $extensions = $_GET['extensions'] ?? $_POST['extensions'] ?? 'base';
        if (empty($city)) {
            echo json_encode(amap_error('缺少参数: city (城市名或 adcode)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/weather/weatherInfo', [
            'key' => $apiKey, 'city' => $city, 'extensions' => $extensions,
        ]);
        if (($result['status'] ?? '0') === '1') {
            echo json_encode(amap_success([
                'lives' => $result['lives'] ?? [],
                'forecasts' => $result['forecasts'] ?? [],
            ]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '天气查询失败'));
        }
        break;
    }

    // ── 10. 行政区划查询 (获取 adcode) ──
    case 'district': {
        $keywords = $_GET['keywords'] ?? $_POST['keywords'] ?? '';
        $subdistrict = intval($_GET['subdistrict'] ?? $_POST['subdistrict'] ?? 0);
        if (empty($keywords)) {
            echo json_encode(amap_error('缺少参数: keywords (城市或区域名)'));
            break;
        }
        $result = amap_get(AMAP_REST_BASE . '/config/district', [
            'key' => $apiKey, 'keywords' => $keywords, 'subdistrict' => $subdistrict,
        ]);
        if (($result['status'] ?? '0') === '1') {
            echo json_encode(amap_success(['districts' => $result['districts'] ?? []]));
        } else {
            echo json_encode(amap_error($result['info'] ?? '行政区划查询失败'));
        }
        break;
    }

    // ── 11. 个人地图小程序二维码 (WIA MCP) ──
    case 'schema_personal_map': {
        // ★ 兼容 JSON body: 前端/MCP 以 application/json POST, PHP $_POST 解析不到
        $rawBody = file_get_contents('php://input');
        $jsonBody = $rawBody ? json_decode($rawBody, true) : null;
        if (!is_array($jsonBody)) {
            $jsonBody = [];
        }
        $orgName = $_POST['orgName'] ?? $jsonBody['orgName'] ?? '';
        $lineList = $_POST['lineList'] ?? $jsonBody['lineList'] ?? '';
        $sceneType = intval($_POST['sceneType'] ?? $jsonBody['sceneType'] ?? 1);
        if (empty($orgName) || empty($lineList)) {
            echo json_encode(amap_error('缺少参数: orgName 和 lineList'));
            break;
        }
        if (is_string($lineList)) {
            $lineList = json_decode($lineList, true);
        }
        if (!is_array($lineList)) {
            echo json_encode(amap_error('lineList 必须是数组'));
            break;
        }
        if (!in_array($sceneType, [1, 2, 3], true)) {
            $sceneType = 1;
        }
        // ★ 2026-08: 高德 WIA 要求每个点 poiId 必填 (工具描述原标"可选"), 缺失时自动按名称搜索补全
        // ⚠️ 不能用 `foreach ($line['pointInfoList'] ?? [] as &$pt)` — ?? 会值拷贝数组,
        //    引用迭代绑定到副本, 赋值写不回原数组; 须经中间变量再写回
        foreach ($lineList as &$line) {
            $pts = $line['pointInfoList'] ?? [];
            foreach ($pts as &$pt) {
                if (empty($pt['poiId'])) {
                    $pt['poiId'] = amap_search_poi_id($apiKey, $pt['name'] ?? '', $pt['lon'] ?? '', $pt['lat'] ?? '');
                }
            }
            unset($pt);
            $line['pointInfoList'] = $pts;  // ★ 显式写回
        }
        unset($line);
        $missingPoi = [];
        foreach ($lineList as $line) {
            foreach ($line['pointInfoList'] ?? [] as $pt) {
                if (empty($pt['poiId'])) {
                    $missingPoi[] = $pt['name'] ?? '未命名地点';
                }
            }
        }
        if ($missingPoi) {
            echo json_encode(amap_error('高德要求 poiId 必填, 且以下地点无法自动匹配, 请在 pointInfoList 中提供 poiId: ' . implode('、', array_unique($missingPoi))));
            break;
        }
        $payload = [
            'channel' => '60000001',
            'orgName' => $orgName,
            'lineList' => $lineList,
            'sceneType' => $sceneType,
        ];
        $url = AMAP_WIA_BASE . '/rest/wia/mcp/schema?key=' . urlencode($apiKey) . '&source=personal-map';
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        ]);
        $resp = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $result = json_decode($resp, true);
        if ($result && ($result['code'] ?? -1) === 1 && ($result['result'] ?? false) === true) {
            $schemaUrl = $result['data']['schemaUrl'] ?? '';
            // 生成二维码 URL
            $qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' . urlencode($schemaUrl);
            echo json_encode(amap_success([
                'qr_code_url' => $qrUrl,
                'schema_url' => $schemaUrl,
                'message' => '📱 个人地图小程序二维码已生成！请使用高德地图App扫描下方二维码查看您的专属地图。',
            ]));
        } else {
            $errMsg = $result['message'] ?? $result['info'] ?? "HTTP {$httpCode}";
            echo json_encode(amap_error('生成地图行程失败: ' . $errMsg));
        }
        break;
    }

    default:
        echo json_encode(amap_error("未知动作: {$action}。支持: config, geo, regeocode, text_search, around_search, search_detail, direction_bicycling, direction_walking, direction_driving, direction_transit, distance, ip_location, weather, district, schema_personal_map"));
        break;
}
