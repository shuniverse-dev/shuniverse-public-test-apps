<?php
require __DIR__ . '/common.php';

try {
    $config = deploy_console_config();
    $requestId = trim((string) ($_GET['request_id'] ?? ''));

    if (!preg_match('/^[0-9]{14}-[a-f0-9]{8}$/', $requestId)) {
        throw new RuntimeException('Invalid request id.');
    }

    $owner = rawurlencode($config['github_owner']);
    $repo = rawurlencode($config['github_repo']);
    $workflow = rawurlencode($config['github_workflow']);

    $runs = github_request(
        $config,
        'GET',
        "/repos/{$owner}/{$repo}/actions/workflows/{$workflow}/runs?event=workflow_dispatch&per_page=20"
    );

    foreach (($runs['workflow_runs'] ?? []) as $run) {
        $title = (string) ($run['display_title'] ?? '');
        if (strpos($title, $requestId) !== false) {
            json_response([
                'ok' => true,
                'status' => $run['status'] ?? 'unknown',
                'conclusion' => $run['conclusion'] ?? null,
                'run_url' => $run['html_url'] ?? null,
            ]);
        }
    }

    json_response([
        'ok' => true,
        'status' => 'waiting',
        'conclusion' => null,
        'run_url' => null,
    ]);
} catch (Throwable $error) {
    json_response(['ok' => false, 'error' => $error->getMessage()], 500);
}
