<?php
require __DIR__ . '/common.php';

try {
    $config = deploy_console_config();
    $data = read_json_body();

    if (!hash_equals((string) $config['deploy_passcode'], (string) ($data['passcode'] ?? ''))) {
        json_response(['ok' => false, 'error' => 'Invalid passcode.'], 403);
    }

    $slug = normalize_slug((string) ($data['slug'] ?? ''));
    $prompt = trim((string) ($data['prompt'] ?? ''));
    $deployMode = (string) ($data['deploy_mode'] ?? 'standard');

    if (!in_array($deployMode, ['standard', 'mobile'], true)) {
        throw new RuntimeException('Invalid deploy mode.');
    }

    if (strlen($prompt) < 20) {
        throw new RuntimeException('Prompt is too short.');
    }

    if (strlen($prompt) > 5000) {
        throw new RuntimeException('Prompt is too long. Keep it under 5000 characters.');
    }

    $requestId = gmdate('YmdHis') . '-' . bin2hex(random_bytes(4));
    $owner = rawurlencode($config['github_owner']);
    $repo = rawurlencode($config['github_repo']);
    $workflow = rawurlencode($config['github_workflow']);

    github_request(
        $config,
        'POST',
        "/repos/{$owner}/{$repo}/actions/workflows/{$workflow}/dispatches",
        [
            'ref' => $config['github_ref'],
            'inputs' => [
                'request_id' => $requestId,
                'app_slug' => $slug,
                'prompt' => $prompt,
                'deploy_mode' => $deployMode,
            ],
        ]
    );

    json_response([
        'ok' => true,
        'request_id' => $requestId,
        'slug' => $slug,
        'deploy_mode' => $deployMode,
        'public_url' => rtrim($config['site_base_url'], '/') . "/{$slug}/",
    ]);
} catch (Throwable $error) {
    json_response(['ok' => false, 'error' => $error->getMessage()], 500);
}
