<?php

namespace Pterodactyl\Http\Controllers\Api\Client\Servers;

use Pterodactyl\Models\Server;
use Pterodactyl\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Services\Plugins\PluginStoreService;
use Pterodactyl\Http\Controllers\Api\Client\ClientApiController;
use Pterodactyl\Http\Requests\Api\Client\Servers\Plugins\PluginStoreRequest;

/**
 * "Add plugin" in the file manager: search Modrinth / SpigotMC and install into /plugins.
 */
class PluginStoreController extends ClientApiController
{
    public function __construct(private PluginStoreService $store)
    {
        parent::__construct();
    }

    public function gameVersion(PluginStoreRequest $request, Server $server): JsonResponse
    {
        return new JsonResponse(['game_version' => $this->store->detectGameVersion($server)]);
    }

    public function search(PluginStoreRequest $request, Server $server): JsonResponse
    {
        $request->validate(['source' => 'required', 'query' => 'required']);

        return new JsonResponse(['results' => $this->wrap(fn () => $this->store->search(
            $request->input('source'),
            $request->input('query'),
            $request->input('game_version')
        ))]);
    }

    public function versions(PluginStoreRequest $request, Server $server): JsonResponse
    {
        $request->validate(['source' => 'required', 'project' => 'required']);

        return new JsonResponse(['versions' => $this->wrap(fn () => $this->store->versions(
            $request->input('source'),
            $request->input('project'),
            $request->input('game_version')
        ))]);
    }

    /**
     * @throws DisplayException
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function install(PluginStoreRequest $request, Server $server): JsonResponse
    {
        $request->validate(['source' => 'required', 'project' => 'required']);

        $installed = $this->store->install($server, $request->input('source'), $request->input('project'), $request->input('version'));

        Activity::event('server:plugin.install')
            ->property('plugin', $installed['plugin_name'])
            ->property('version', $installed['plugin_version'])
            ->property('file', $installed['file_name'])
            ->property('source', $request->input('source'))
            ->log();

        return new JsonResponse($installed);
    }

    /**
     * Turns upstream API failures into a readable message instead of a generic 500.
     */
    private function wrap(callable $callback): array
    {
        try {
            return $callback();
        } catch (\RuntimeException|\Illuminate\Http\Client\ConnectionException $exception) {
            throw new DisplayException('Could not reach Modrinth/SpigotMC: ' . $exception->getMessage());
        }
    }
}
