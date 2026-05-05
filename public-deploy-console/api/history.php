<?php
require __DIR__ . '/common.php';

try {
    $history = array_values(array_filter(read_history(), static function (array $entry): bool {
        return isset($entry['url'], $entry['slug']);
    }));

    json_response([
        'ok' => true,
        'items' => array_slice($history, 0, 20),
    ]);
} catch (Throwable $error) {
    json_response(['ok' => false, 'error' => $error->getMessage()], 500);
}
