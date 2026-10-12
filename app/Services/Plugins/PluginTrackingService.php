<?php

namespace Pterodactyl\Services\Plugins;

use Pterodactyl\Models\User;
use Pterodactyl\Models\Server;

/**
 * Decides which servers take part in plugin update checks, from the "Plugin tracking" toggles on
 * the root admins' dashboard sections.
 *
 * A server is tracked when any root admin tracks it in the dashboard view it appears in: the
 * "own" view for servers the admin can access as owner or subuser, the "admin" view for the rest.
 * Inside a view, a server in a section follows that section's toggle and any other server follows
 * the "Other servers" toggle. Both default to on, as they do on the dashboard.
 */
class PluginTrackingService
{
    /** @var array<int, true>|null */
    private ?array $tracked = null;

    public function isTracked(Server $server): bool
    {
        $tracked = $this->trackedServerIds();

        return $tracked === null || isset($tracked[$server->id]);
    }

    /**
     * @return array<int, true>|null server ids keyed for lookup, or null when every server is tracked
     */
    public function trackedServerIds(): ?array
    {
        if ($this->tracked !== null) {
            return $this->tracked;
        }

        $admins = User::query()->where('root_admin', true)->whereNotNull('dashboard_layout')->get();
        if ($admins->isEmpty()) {
            return null;
        }

        $servers = Server::query()->get(['id', 'uuid']);
        $tracked = [];

        foreach ($admins as $admin) {
            $accessible = array_flip($admin->accessibleServers()->pluck('id')->all());
            $layout = $admin->dashboard_layout;

            // Layouts saved before the own/admin split are a single "own" layout.
            if (!array_key_exists('own', $layout) && !array_key_exists('admin', $layout)) {
                $layout = ['own' => $layout, 'admin' => []];
            }

            foreach ($servers as $server) {
                $view = isset($accessible[$server->id]) ? ($layout['own'] ?? []) : ($layout['admin'] ?? []);

                if ($this->trackedInView(is_array($view) ? $view : [], $server->uuid)) {
                    $tracked[$server->id] = true;
                }
            }
        }

        return $this->tracked = $tracked;
    }

    private function trackedInView(array $view, string $uuid): bool
    {
        foreach ($view['sections'] ?? [] as $section) {
            if (in_array($uuid, $section['serverUuids'] ?? [], true)) {
                return filter_var($section['trackPlugins'] ?? true, FILTER_VALIDATE_BOOLEAN);
            }
        }

        return filter_var($view['trackUnsectionedPlugins'] ?? true, FILTER_VALIDATE_BOOLEAN);
    }
}
