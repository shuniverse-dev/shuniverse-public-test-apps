<?php
require __DIR__ . '/common.php';

try {
    $config = deploy_console_config();
    $data = read_json_body();

    if (!hash_equals((string) $config['deploy_passcode'], (string) ($data['passcode'] ?? ''))) {
        json_response(['ok' => false, 'error' => 'Invalid passcode.'], 403);
    }

    $slug = allocate_app_slug();
    $prompt = trim((string) ($data['prompt'] ?? ''));
    $deployMode = (string) ($data['deploy_mode'] ?? 'standard');

    if (!in_array($deployMode, ['standard', 'mobile'], true)) {
        throw new RuntimeException('Invalid deploy mode.');
    }

    if (strlen($prompt) < 10) {
        throw new RuntimeException('Prompt is too short.');
    }

    if (strlen($prompt) > 5000) {
        throw new RuntimeException('Prompt is too long. Keep it under 5000 characters.');
    }

    if (!preg_match('/^PUBLIC\s+(MOBILE\s+)?DEPLOY:/i', $prompt)) {
        $command = $deployMode === 'mobile' ? 'PUBLIC MOBILE DEPLOY:' : 'PUBLIC DEPLOY:';
        $prompt = $command . "\n" . $prompt;
    }

    $requestId = gmdate('YmdHis') . '-' . bin2hex(random_bytes(4));
    $publicUrl = rtrim($config['site_base_url'], '/') . "/{$slug}/";
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

    add_history_entry([
        'request_id' => $requestId,
        'slug' => $slug,
        'url' => $publicUrl,
        'mode' => $deployMode,
        'label' => prompt_label($prompt),
        'status' => 'queued',
        'created_at' => gmdate('c'),
        'updated_at' => gmdate('c'),
        'run_url' => null,
    ]);

    json_response([
        'ok' => true,
        'request_id' => $requestId,
        'slug' => $slug,
        'deploy_mode' => $deployMode,
        'public_url' => $publicUrl,
    ]);
} catch (Throwable $error) {
    json_response(['ok' => false, 'error' => $error->getMessage()], 500);
}
