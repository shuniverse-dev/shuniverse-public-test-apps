<?php
function deploy_console_config(): array
{
    $path = __DIR__ . '/config.local.php';
    if (!is_file($path)) {
        throw new RuntimeException('Server config is missing. Create api/config.local.php from config.example.php.');
    }

    $config = require $path;
    $required = [
        'github_owner',
        'github_repo',
        'github_workflow',
        'github_ref',
        'github_token',
        'deploy_passcode',
        'site_base_url',
    ];

    foreach ($required as $key) {
        if (empty($config[$key])) {
            throw new RuntimeException("Server config value is missing: {$key}");
        }
    }

    return $config;
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) {
        throw new RuntimeException('Request body must be JSON.');
    }

    return $data;
}

function normalize_slug(string $value): string
{
    $value = strtolower(trim($value));
    $value = preg_replace('/^https?:\/\/soulhouseproductions\.com\//', '', $value);
    $value = trim($value, "/ \t\n\r\0\x0B");
    $value = preg_replace('/[^a-z0-9-]+/', '-', $value);
    $value = trim($value, '-');

    if (!preg_match('/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/', $value)) {
        throw new RuntimeException('Public path must be 3-64 characters using letters, digits, and hyphens.');
    }

    return $value;
}

function allocate_app_slug(): string
{
    $path = __DIR__ . '/app-counter.txt';
    $handle = fopen($path, 'c+');
    if ($handle === false) {
        throw new RuntimeException('Unable to open app counter.');
    }

    try {
        if (!flock($handle, LOCK_EX)) {
            throw new RuntimeException('Unable to lock app counter.');
        }

        rewind($handle);
        $raw = stream_get_contents($handle);
        $current = is_string($raw) && trim($raw) !== '' ? (int) trim($raw) : 0;
        $next = $current + 1;

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, (string) $next);
        fflush($handle);
        flock($handle, LOCK_UN);

        return 'app-' . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    } finally {
        fclose($handle);
    }
}

function github_request(array $config, string $method, string $path, ?array $payload = null): array
{
    $url = "https://api.github.com{$path}";
    $headers = [
        'Accept: application/vnd.github+json',
        'Authorization: Bearer ' . $config['github_token'],
        'Content-Type: application/json',
        'User-Agent: Soulhouse-Public-Deploy-Console',
        'X-GitHub-Api-Version: 2022-11-28',
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);

    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_SLASHES));
    }

    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException("GitHub request failed: {$error}");
    }

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("GitHub request returned {$status}: {$body}");
    }

    if ($body === '' || $status === 204) {
        return [];
    }

    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : [];
}
