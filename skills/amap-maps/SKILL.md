---
name: amap-maps
description: 高德地图地理服务 — 地理编码/逆编码、POI搜索、周边搜索、路径规划(步行/驾车/骑行/公交)、距离测量、天气查询、IP定位、行政区划、个人地图二维码。基于ClawHub @lbs-amap (GaodeMapOfficial) personal-map Skill。Use for location search, route planning, weather, and map services.
version: 1.0.0
metadata:
  oneapichat:
    tools: [amap_geo, amap_regeocode, amap_text_search, amap_around_search, amap_search_detail, amap_direction_walking, amap_direction_driving, amap_direction_bicycling, amap_direction_transit, amap_distance, amap_ip_location, amap_weather, amap_district, amap_schema_personal_map]
    priority: high
    emoji: "🗺️"
    triggers: [地图, 高德, 地理编码, 逆地理编码, POI搜索, 周边搜索, 步行路线, 驾车路线, 骑行路线, 公交路线, 距离测量, 天气查询, IP定位, 行政区划, 个人地图, 二维码, 导航, 定位, 地址, 经纬度, 坐标, 地点, 附近, 周边, 天气, amap, 高德地图]
---

# 🗺️ 高德地图地理服务

地理编码、POI搜索、路径规划、天气查询等14个高德Web服务API一站式集成。

## 何时使用

- 用户要查询某个地点的位置/坐标
- 用户要搜索附近的餐厅/酒店/加油站等
- 用户要规划出行路线(步行/驾车/骑行/公交)
- 用户要查询天气
- 用户要测量两地之间的距离
- 用户要获取行政区划信息

## 工具矩阵

### 📍 地理编码 (2个)

| 工具 | 功能 | 示例 |
|------|------|------|
| `amap_geo` | 地址→坐标 | "北京市朝阳区阜通东大街6号" → 116.48,39.99 |
| `amap_regeocode` | 坐标→地址 | "116.48,39.99" → 北京市朝阳区... |

### 🔍 POI搜索 (3个)

| 工具 | 功能 | 示例 |
|------|------|------|
| `amap_text_search` | 关键词POI搜索 | 搜"麦当劳" |
| `amap_around_search` | 周边搜索 | 搜当前位置附近的"餐厅" |
| `amap_search_detail` | POI详情 | 获取某个POI的详细信息 |

### 🗺️ 路径规划 (4个)

| 工具 | 功能 | 限制 |
|------|------|------|
| `amap_direction_walking` | 步行路线 | ≤100km |
| `amap_direction_driving` | 驾车路线 | 考虑实时路况 |
| `amap_direction_bicycling` | 骑行路线 | ≤500km |
| `amap_direction_transit` | 公交/地铁 | 综合公共交通 |

### 📏 其他 (5个)

| 工具 | 功能 |
|------|------|
| `amap_distance` | 距离测量(直线/驾车/步行) |
| `amap_weather` | 天气查询(实时/预报) |
| `amap_ip_location` | IP定位 |
| `amap_district` | 行政区划查询 |
| `amap_schema_personal_map` | 个人地图二维码生成 |

## 工作流

### 地点搜索
```
用户: "北京天安门附近有什么好吃的？"
1. amap_geo(address="北京天安门") → 获取坐标
2. amap_around_search(location="116.397,39.908", keywords="美食", radius=1000)
3. 展示结果给用户
```

### 路线规划
```
用户: "从北京天安门到上海外滩怎么走？"
1. amap_geo(address="北京天安门") → 起点坐标
2. amap_geo(address="上海外滩") → 终点坐标
3. amap_direction_driving(origin="116.397,39.908", destination="121.473,31.230")
4. 展示路线信息
```

### 天气查询
```
用户: "北京今天天气怎么样？"
1. amap_weather(city="北京")
2. 展示天气信息
```

## 注意事项

- API Key已配置在服务器端, 用户无需手动输入
- 地理编码支持地标性名胜景区、建筑物名称解析
- 路径规划支持实时路况(驾车模式)
- 公交路线默认城市为北京, 其他城市需指定city参数
- 距离测量: type=0直线, type=1驾车(默认), type=3步行
