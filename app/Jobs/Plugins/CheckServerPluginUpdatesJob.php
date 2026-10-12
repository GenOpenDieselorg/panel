<?php

namespace Pterodactyl\Jobs\Plugins;

use Pterodactyl\Models\Server;
use Illuminate\Support\Facades\Cache;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Queue\Attributes\WithoutRelations;
use Illuminate\Queue\Attributes\DeleteWhenMissingModels;
use Pterodactyl\Services\Plugins\PluginUpdateCheckService;

/**
 * Runs an on-demand plugin update check for a single server.
 */
#[DeleteWhenMissingModels]
class CheckServerPluginUpdatesJob implements ShouldQueue, ShouldBeUnique
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 1800;

    public function __construct(#[WithoutRelations] public readonly Server $server)
    {
    }

    public static function cacheKey(Server $server): string
    {
        return "plugin-updates:checking:{$server->id}";
    }

    public function uniqueId(): string
    {
        return (string) $this->server->id;
    }

    public function handle(PluginUpdateCheckService $service): void
    {
        try {
            $service->check($this->server);
        } finally {
            Cache::forget(self::cacheKey($this->server));
        }
    }

    public function failed(): void
    {
        Cache::forget(self::cacheKey($this->server));
    }
}
