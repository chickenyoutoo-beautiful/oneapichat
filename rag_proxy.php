<?php
/**
 * RAG (Retrieval Augmented Generation) Proxy
 * Minimal stub — returns empty/default responses when RAG backend is not configured.
 * Prevents 404 errors in the console.
 */
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = $_GET['action'] ?? '';
$collection = $_GET['collection'] ?? 'default';

switch ($action) {
    case 'collections':
        echo json_encode(['collections' => []]);
        break;
    case 'knowledge':
        echo json_encode(['items' => [], 'total' => 0]);
        break;
    case 'embed_config':
        echo json_encode([
            'embed_model' => '',
            'embed_api_base' => '',
            'embed_api_key' => '',
            'chunk_size' => 512,
            'chunk_overlap' => 50
        ]);
        break;
    case 'list_models':
        echo json_encode(['models' => []]);
        break;
    case 'search':
        echo json_encode(['results' => []]);
        break;
    case 'upload':
        echo json_encode(['success' => false, 'error' => 'RAG backend not configured']);
        break;
    default:
        echo json_encode(['error' => 'Unknown action', 'action' => $action]);
}
