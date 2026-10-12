<?php

namespace Pterodactyl\Console\Commands\Plugins;

use Illuminate\Console\Command;
use Pterodactyl\Models\Server;
use Pterodactyl\Services\Plugins\PluginTrackingService;
use Pterodactyl\Services\Plugins\PluginUpdateCheckService;

class CheckPluginUpdatesCommand extends Command
{
    protected $signature = 'p:plugins:check-updates
                            {--server= : Only check the server with this id}';

    protected $description = 'Indexes the plugin jars of every server and looks up newer versions on Modrinth and SpigotMC.';

    public function handle(PluginUpdateCheckService $service, PluginTrackingService $tracking): int
    {
        $servers = Server::query()
            ->with('node')
            ->when($this->option('server'), fn ($query, $id) => $query->where('id', $id))
            ->whereNull('status')
            ->get();

        foreach ($servers as $server) {
            // Only servers with "Plugin tracking" switched on in a dashboard section are checked.
            if (!$tracking->isTracked($server)) {
                $this->line(sprintf('%d %s: skipped (plugin tracking is off)', $server->id, $server->name));

                continue;
            }

            try {
                $plugins = $service->check($server);
            } catch (\Throwable $exception) {
                // Servers without a /plugins directory (proxies, non-Minecraft eggs) land here too.
                $this->line(sprintf('%d %s: skipped (%s)', $server->id, $server->name, class_basename($exception)));

                continue;
            }

            $this->info(sprintf(
                '%d %s: %d jars, %d updates',
                $server->id,
                $server->name,
                $plugins->count(),
                $plugins->where('status', 'update_available')->count()
            ));
        }

        // Servers checked early in the run can now borrow matches found on later ones.
        $this->info(sprintf('Shared matches with %d plugins on other servers.', $service->propagate()));

        return self::SUCCESS;
    }
}
