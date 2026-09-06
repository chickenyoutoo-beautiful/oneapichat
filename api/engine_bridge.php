<?php
/** Local OneAPIChat PHP -> FastAPI bridge authentication helpers. */
function oneapichatEngineBridgeSecret(): string {
    static $secret = null;
    if ($secret !== null) return $secret;
    $path = dirname(__DIR__) . '/.engine/internal_bridge.key';
    $raw = is_readable($path) ? file_get_contents($path) : false;
    $secret = ($raw !== false) ? trim($raw) : '';
    return strlen($secret) >= 32 ? $secret : '';
}

function oneapichatEngineHeaders(array $headers = []): array {
    $secret = oneapichatEngineBridgeSecret();
    if ($secret !== '') $headers[] = 'X-OneAPIChat-Internal: ' . $secret;
    return $headers;
}

function oneapichatEngineContext(array $http = []) {
    $headers = $http['header'] ?? [];
    if (is_string($headers)) $headers = preg_split('/\r?\n/', trim($headers));
    $http['header'] = oneapichatEngineHeaders(is_array($headers) ? $headers : []);
    $http['ignore_errors'] = $http['ignore_errors'] ?? true;
    return stream_context_create(['http' => $http]);
}
