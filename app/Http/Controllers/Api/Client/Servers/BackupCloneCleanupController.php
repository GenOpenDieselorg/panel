<?php

namespace Pterodactyl\Http\Controllers\Api\Client\Servers;

use Illuminate\Http\Request;
use Pterodactyl\Models\Backup;
use Pterodactyl\Models\Server;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Models\Permission;
use Illuminate\Support\Facades\Cache;
use Illuminate\Auth\Access\AuthorizationException;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;
use Pterodactyl\Services\Backups\CreateServerFromBackupService;
use Pterodactyl\Services\Backups\PluginPatternMatcher;
use Pterodactyl\Services\Backups\BackupClonePluginTemplateService;
use Pterodactyl\Http\Controllers\Api\Client\ClientApiController;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Pterodactyl\Http\Requests\Api\Client\Servers\Backups\BackupCloneCleanupRequest;

class BackupCloneCleanupController extends ClientApiController
{
    public function __construct(
        private DaemonFileRepository $fileRepository,
        private PluginPatternMatcher $pluginPatternMatcher,
        private BackupClonePluginTemplateService $pluginTemplateService,
    ) {
        parent::__construct();
    }

    /**
     * Returns the list of plugins available for cleanup on a cloned server.
     *
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     * @throws AuthorizationException
     */
    public function plugins(Request $request, Server $server): JsonResponse
    {
        if (!$request->user()->can(Permission::ACTION_FILE_READ, $server)) {
            throw new AuthorizationException();
        }

        $this->assertAwaitingPlugins($server);

        $plugins = $this->listJarPlugins($server);

        $state = CreateServerFromBackupService::getCloneState($server->id);
        $template = is_array($state) && !empty($state['plugin_template'])
            ? $state['plugin_template']
            : $this->pluginTemplateService->get();

        $names = array_column($plugins, 'name');

        // The choice made while creating the server pre-fills the dialog, so the
        // user only has to confirm it once the restore finishes.
        $selection = collect(is_array($state) ? ($state['plugin_selection'] ?? []) : [])
            ->filter(fn ($name) => is_string($name))
            ->intersect($names)
            ->values()
            ->all();

        return new JsonResponse([
            'plugins' => $plugins,
            'template' => $template,
            'mode' => is_array($state) && ($state['plugin_mode'] ?? null) === 'keep' ? 'keep' : 'remove',
            'selection' => $selection,
        ]);
    }

    /**
     * Deletes plugins and finalizes the clone cleanup process.
     *
     * Two selection modes are supported:
     *  - remove: the submitted plugins (plus pattern matches) are deleted;
     *  - keep:   the submitted plugins are kept and every other jar is deleted.
     *
     * Only *.jar files are ever touched — directories inside /plugins are left alone.
     *
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function cleanup(BackupCloneCleanupRequest $request, Server $server): JsonResponse
    {
        $state = CreateServerFromBackupService::getCloneState($server->id);
        if (!is_array($state) || ($state['status'] ?? null) !== 'awaiting_plugins') {
            throw new NotFoundHttpException('No pending plugin cleanup was found for this server.');
        }

        $plugins = $this->listJarPlugins($server);
        $names = array_column($plugins, 'name');

        $submitted = collect($request->input('plugins', []))
            ->filter(fn ($name) => is_string($name) && $this->isSafePluginName($name));

        if ($request->input('mode') === 'keep') {
            $kept = $submitted->map(fn (string $name) => strtolower($name))->all();

            $selected = collect($names)
                ->reject(fn (string $name) => in_array(strtolower($name), $kept, true))
                ->values()
                ->all();
        } else {
            $selected = $submitted
                ->merge($this->pluginPatternMatcher->match($plugins, $request->input('patterns', [])))
                ->unique()
                ->intersect($names)
                ->values()
                ->all();
        }

        if (!empty($selected)) {
            $this->fileRepository->setServer($server)->deleteFiles('/plugins', $selected);
        }

        if (isset($state['temp_backup_id'])) {
            Backup::query()->where('id', $state['temp_backup_id'])->delete();
        }

        Cache::forget(CreateServerFromBackupService::cacheKey($server->id));
        CreateServerFromBackupService::untrackClone($server->id);

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    private function assertAwaitingPlugins(Server $server): void
    {
        if (!CreateServerFromBackupService::isAwaitingPluginSelection($server->id)) {
            throw new NotFoundHttpException('No pending plugin cleanup was found for this server.');
        }
    }

    /**
     * @return array<int, array{name: string, type: string}>
     */
    private function listPlugins(Server $server): array
    {
        $plugins = [];

        try {
            $files = $this->fileRepository->setServer($server)->getDirectory('/plugins');
            foreach ($files as $file) {
                $name = $file['name'] ?? '';
                if ($name === '' || $name === '.' || $name === '..' || !$this->isSafePluginName($name)) {
                    continue;
                }

                $isDirectory = !($file['file'] ?? true);

                $plugins[] = [
                    'name' => $name,
                    'type' => $isDirectory ? 'directory' : 'file',
                ];
            }
        } catch (\Exception) {
            // plugins folder may not exist yet
        }

        usort($plugins, fn ($a, $b) => strcasecmp($a['name'], $b['name']));

        return $plugins;
    }

    /**
     * Returns only the jar files inside /plugins. Directories and any other
     * file type are dropped so they can never be selected for deletion.
     *
     * @return array<int, array{name: string, type: string}>
     */
    private function listJarPlugins(Server $server): array
    {
        return array_values(array_filter(
            $this->listPlugins($server),
            fn (array $plugin) => $plugin['type'] === 'file' && str_ends_with(strtolower($plugin['name']), '.jar'),
        ));
    }

    private function isSafePluginName(string $name): bool
    {
        return $name !== ''
            && !str_contains($name, '/')
            && !str_contains($name, '\\')
            && !str_contains($name, '..');
    }
}
