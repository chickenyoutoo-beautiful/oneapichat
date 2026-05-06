<?php
// parse.php - AI可调用的文件解析API
// 支持: txt, md, js, py, json, html, css, xml, csv, log, sh, bat, conf, ini, docx, xlsx, xls, xlsm, jpg, png, gif, webp, bmp, svg
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$result = ['success' => false, 'filename' => '', 'type' => '', 'content' => '', 'error' => ''];

try {
    if (isset($_FILES['file'])) {
        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            throw new Exception('Upload error: ' . $file['error']);
        }
        $filename = $file['name'];
        $tmpPath = $file['tmp_name'];
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $mime = mime_content_type($tmpPath);
        $content = parseFile($tmpPath, $ext, $mime);
    } elseif (isset($_POST['filename'], $_POST['content'])) {
        $filename = $_POST['filename'];
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $mime = $_POST['type'] ?? 'auto';
        $isBase64 = isset($_POST['encoding']) && $_POST['encoding'] === 'base64';
        $tmpDir = sys_get_temp_dir();
        $tmpPath = $tmpDir . '/parse_' . uniqid();
        file_put_contents($tmpPath, $isBase64 ? base64_decode($_POST['content']) : $_POST['content']);
        $content = parseFile($tmpPath, $ext, $mime);
        @unlink($tmpPath);
    } else {
        throw new Exception('No file. POST multipart/form-data with "file", or JSON body with filename+content.');
    }
    // 限制内容长度，避免超出模型上下文
    if (strlen($content) > 8000) {
        $content = substr($content, 0, 8000) . "\n\n[内容过长，已截断前8000字符...]";
    }
    
    $result['success'] = true;
    $result['filename'] = $filename;
    $result['type'] = $ext;
    $result['content'] = $content;
} catch (Exception $e) {
    $result['error'] = $e->getMessage();
}

echo json_encode($result, JSON_UNESCAPED_UNICODE);

function parseFile($path, $ext, $mime) {
    $textExts = ['txt','md','js','py','json','html','css','xml','csv','log','sh','bat','conf','ini','yaml','yml','sql','go','rs','c','cpp','h','hpp','ts','tsx','jsx','vue','php','rb','pl','r','lua','swift','kt','scala','groovy','gradle','toml','properties','env','gitignore','dockerfile','makefile','nginx','apache','jsonc','mdx'];
    $imageExts = ['jpg','jpeg','png','gif','webp','bmp','tiff','tif','svg','ico','webp'];

    if (in_array($ext, $imageExts) || strpos($mime, 'image/') === 0) {
        $data = @file_get_contents($path);
        if ($data === false) throw new Exception('Failed to read image');
        $detectedMime = $mime !== 'auto' && $mime !== '' ? $mime : 'image/' . $ext;
        return 'data:' . $detectedMime . ';base64,' . base64_encode($data);
    }

    if (in_array($ext, $textExts) || strpos($mime, 'text/') === 0 || $mime === 'application/octet-stream' || $mime === 'application/json') {
        $content = @file_get_contents($path);
        if ($content === false) throw new Exception('Failed to read text file');
        if (strlen($content) > 5 * 1024 * 1024) {
            $content = substr($content, 0, 5 * 1024 * 1024) . "\n\n[TRUNCATED: exceeds 5MB]";
        }
        return $content;
    }

    if ($ext === 'docx' || strpos($mime, 'word') !== false || strpos($mime, 'document') !== false) {
        return parseDocx($path);
    }

    if (in_array($ext, ['xlsx','xls','xlsm']) || strpos($mime, 'spreadsheet') !== false || strpos($mime, 'excel') !== false) {
        return parseXlsx($path);
    }

    // fallback
    $content = @file_get_contents($path);
    if ($content !== false) return $content;
    throw new Exception("Unsupported: $ext ($mime)");
}

function parseDocx($path) {
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new Exception('Cannot open docx');
    $text = '';
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name === 'word/document.xml') {
            $xml = $zip->getFromIndex($i);
            if (preg_match_all('/<w:t[^>]*>([^<]*)<\/w:t>/u', $xml, $matches)) {
                $text = implode("\n", $matches[1]);
            }
            break;
        }
    }
    $zip->close();
    if (empty($text)) throw new Exception('No text found in docx');
    return $text;
}

function parseXlsx($path) {
    $tmpOut = sys_get_temp_dir() . '/xlsx_' . uniqid() . '.txt';
    $escapedPath = escapeshellarg($path);
    $cmd = "python3 -c \"
import sys, zipfile, xml.etree.ElementTree as ET, os
path = $escapedPath
try:
    with zipfile.ZipFile(path) as zf:
        sheets = sorted([n for n in zf.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')])
        # 尝试读共享字符串
        shared = []
        if 'xl/sharedStrings.xml' in zf.namelist():
            with zf.open('xl/sharedStrings.xml') as f:
                tree = ET.parse(f)
                for si in tree.getroot().findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                    t = si.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                    shared.append(t.text if t is not None else '')
        ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        for i, sheet in enumerate(sheets, 1):
            print(f'=== Sheet {i} ===')
            with zf.open(sheet) as f:
                tree = ET.parse(f)
                for row in tree.getroot().findall('.//x:row', ns):
                    cells = []
                    for c in row.findall('x:c', ns):
                        t = c.get('t','')
                        v = c.find('x:v', ns)
                        val = v.text if v is not None else ''
                        if t == 's' and shared:
                            idx = int(val) if val.isdigit() else 0
                            val = shared[idx] if idx < len(shared) else ''
                        cells.append(val)
                    if any(c.strip() for c in cells):
                        print(chr(9).join(cells))
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
\" > " . escapeshellarg($tmpOut) . " 2>&1";
    
    @exec($cmd, $out, $ret);
    if (file_exists($tmpOut)) {
        $result = file_get_contents($tmpOut);
        @unlink($tmpOut);
        if (!empty(trim($result))) return $result;
    }
    // fallback
    $content = @file_get_contents($path);
    if ($content !== false) return '[xlsx raw]' . substr($content, 0, 4096);
    throw new Exception('xlsx parse failed');
}
