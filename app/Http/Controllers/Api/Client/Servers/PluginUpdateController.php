<?php

namespace Pterodactyl\Http\Controllers\Api\Client\Servers;

use Illuminate\Http\Response;
use Pterodactyl\Models\Server;
use Pterodactyl\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Models\ServerPlugin;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Models\PluginUpdateRule;
use Pterodactyl\Services\Plugins\PluginUpdateService;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Services\Plugins\PluginTrackingService;
use Pterodactyl\Jobs\Plugins\CheckServerPluginUpdatesJob;
use Pterodactyl\Http\Controllers\Api\Client\ClientApiController;
use Pterodactyl\Http\Requests\Api\Client\Servers\Plugins\UpdatePluginRequest;
use Pterodactyl\Http\Requests\Api\Client\Servers\Plugins\ListPluginUpdatesRequest;
use Pterodactyl\Http\Requests\Api\Client\Servers\Plugins\CheckPluginUpdatesRequest;

class PluginUpdateController extends ClientApiController
{
    public function __construct(
        private PluginUpdateService $updateService,
        private PluginTrackingService $tracking,
    ) {
        parent::__construct();
    }

    /**
     * Returns the results of the last plugin update check for the server.
     */
    public function index(ListPluginUpdatesRequest $request, Server $server): JsonResponse
    {
        if (!$this->tracking->isTracked($server)) {
            return new JsonResponse(['tracked' => false, 'checking' => false, 'last_checked_at' => null, 'plugins' => []]);
        }

        $plugins = ServerPlugin::query()->where('server_id', $server->id)->orderBy('file_name')->get();

        $rules = PluginUpdateRule::query()->get();

        return new JsonResponse([
            'tracked' => true,
            'checking' => Cache::has(CheckServerPluginUpdatesJob::cacheKey($server)),
            'last_checked_at' => $plugins->max('checked_at')?->toAtomString(),
            'plugins' => $plugins->map(fn (ServerPlugin $plugin) => $this->transform($plugin, PluginUpdateRule::findFor($plugin, $rules)))->values(),
        ]);
    }

    /**
     * Queues an immediate update check for this server.
     */
    public function check(CheckPluginUpdatesRequest $request, Server $server): JsonResponse
    {
        if (!$this->tracking->isTracked($server)) {
            throw new DisplayException('Plugin tracking is off for this server. Turn it on for its section on the dashboard.');
        }

        if (Cache::add(CheckServerPluginUpdatesJob::cacheKey($server), true, now()->addMinutes(30))) {
            CheckServerPluginUpdatesJob::dispatch($server);
        }

        return new JsonResponse([], Response::HTTP_ACCEPTED);
    }

    /**
     * Replaces a plugin jar with its newest upstream version.
     *
     * @throws \Pterodactyl\Exceptions\DisplayException
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function update(UpdatePluginRequest $request, Server $server): JsonResponse
    {
        /** @var ServerPlugin $plugin */
        $plugin = ServerPlugin::query()
            ->where('server_id', $server->id)
            ->where('file_name', $request->input('file'))
            ->firstOrFail();

        $old = $plugin->replicate();
        $updated = $this->updateService->handle($server, $plugin);

        Activity::event('server:plugin.update')
            ->property('plugin', $old->plugin_name)
            ->property('from', $old->plugin_version)
            ->property('to', $updated?->plugin_version ?? $old->latest_version)
            ->property('file', $updated?->file_name)
            ->property('source', $old->project_url)
            ->log();

        return new JsonResponse([
            'plugin' => $updated ? $this->transform($updated, null) : null,
        ]);
    }

    private function transform(ServerPlugin $plugin, ?PluginUpdateRule $rule): array
    {
        return [
            'file_name' => $plugin->file_name,
            'plugin_name' => $plugin->plugin_name,
            'plugin_version' => $plugin->plugin_version,
            'plugin_authors' => $plugin->plugin_authors ?? [],
            'status' => $plugin->status,
            'source' => $plugin->source,
            'project_title' => $plugin->project_title,
            'project_url' => $plugin->project_url,
            'latest_version' => $plugin->latest_version,
            'latest_game_versions' => $plugin->latest_game_versions ?? [],
            'error' => $plugin->error,
            'checked_at' => $plugin->checked_at?->toAtomString(),
            'rule' => $rule ? ['id' => $rule->id, 'type' => $rule->type, 'pattern' => $rule->pattern(), 'project_url' => $rule->project_url] : null,
        ];
    }
}
