<?php

namespace Pterodactyl\Services\Plugins;

use Carbon\Carbon;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\ServerPlugin;
use Pterodactyl\Models\PluginUpdateRule;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;
use Pterodactyl\Exceptions\DisplayException;

/**
 * Replaces an installed plugin jar with the newest upstream build.
 *
 * The new jar is verified before anything on the server is touched, and the old jar is moved to
 * /plugins/.update-backups rather than deleted, so a bad update can be rolled back by hand.
 */
class PluginUpdateService
{
    public const BACKUP_DIRECTORY = '.update-backups';

    private const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;

    public function __construct(
        private DaemonFileRepository $fileRepository,
        private PluginJarInspector $inspector,
        private PluginSourceResolver $resolver,
        private PluginUpdateCheckService $checkService,
    ) {
    }

    /**
     * @return ServerPlugin|null the row for the new jar
     *
     * @throws DisplayException
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function handle(Server $server, ServerPlugin $plugin): ?ServerPlugin
    {
        if ($plugin->status !== ServerPlugin::STATUS_UPDATE_AVAILABLE || !$plugin->download_url) {
            throw new DisplayException('Dla tego pluginu nie ma dostępnej aktualizacji.');
        }

        $temp = tempnam(sys_get_temp_dir(), 'plugin-update-');

        try {
            $this->download($plugin->download_url, $temp);
            $meta = $this->inspector->inspect($temp);

            if (!$meta) {
                throw new DisplayException('Pobrany plik nie jest poprawnym pluginem (brak plugin.yml).');
            }

            if (PluginUpdateRule::keyFor($meta['name']) !== $plugin->plugin_key) {
                throw new DisplayException(sprintf(
                    'Pobrany plik to plugin "%s", a nie "%s" — aktualizacja przerwana. Popraw link do projektu.',
                    $meta['name'],
                    $plugin->plugin_name
                ));
            }

            if ($this->resolver->versionsMatch($meta['version'], $plugin->plugin_version ?? '')) {
                throw new DisplayException(sprintf(
                    'Źródło zwróciło tę samą wersję (%s), którą masz zainstalowaną. Spróbuj ponownie później.',
                    $meta['version']
                ));
            }

            $this->install($server, $plugin, $temp);
        } finally {
            @unlink($temp);
        }

        $plugin->delete();
        $this->checkService->index($server);

        return $this->checkService->resolve(
            ServerPlugin::query()->where('server_id', $server->id)->where('status', ServerPlugin::STATUS_PENDING)->get()
        )->first();
    }

    private function download(string $url, string $destination): void
    {
        try {
            $response = $this->resolver->http()
                ->accept('*/*')
                ->timeout(180)
                ->withOptions([
                    'sink' => $destination,
                    'on_headers' => function ($response) {
                        if ((int) $response->getHeaderLine('Content-Length') > self::MAX_DOWNLOAD_BYTES) {
                            throw new \RuntimeException('file too large');
                        }
                    },
                ])
                ->get($url);
        } catch (\Throwable $exception) {
            throw new DisplayException('Nie udało się pobrać nowej wersji: ' . $exception->getMessage());
        }

        if (!$response->successful()) {
            throw new DisplayException(sprintf('Nie udało się pobrać nowej wersji (HTTP %d).', $response->status()));
        }
    }

    private function install(Server $server, ServerPlugin $plugin, string $jar): void
    {
        $repository = $this->fileRepository->setServer($server);
        $directory = PluginUpdateCheckService::PLUGIN_DIRECTORY;

        $existing = collect($repository->getDirectory($directory))->pluck('name')->all();

        $target = $plugin->download_file_name ?: $plugin->file_name;
        if ($target !== $plugin->file_name && in_array($target, $existing, true)) {
            $target = preg_replace('/\.jar$/i', '', $target) . '-' . Carbon::now()->format('YmdHis') . '.jar';
        }

        // Upload under a name the server ignores, then swap it in. The running server keeps its
        // handle on the old jar, so moving it away underneath it is safe until the next restart.
        $partial = $target . '.part';
        $repository->writeFile("$directory/$partial", $jar);

        if (!in_array(self::BACKUP_DIRECTORY, $existing, true)) {
            $repository->createDirectory(self::BACKUP_DIRECTORY, $directory);
        }

        $backupName = sprintf('%s/%s-%s', self::BACKUP_DIRECTORY, Carbon::now()->format('Ymd-His'), $plugin->file_name);

        $repository->renameFiles($directory, [['from' => $plugin->file_name, 'to' => $backupName]]);
        $repository->renameFiles($directory, [['from' => $partial, 'to' => $target]]);
    }
}
