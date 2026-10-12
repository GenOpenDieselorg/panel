<?php

namespace Pterodactyl\Services\Plugins;

use Carbon\Carbon;
use Illuminate\Support\Collection;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\ServerPlugin;
use Pterodactyl\Models\PluginUpdateRule;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;

/**
 * Indexes the jars in a server's /plugins directory and resolves available updates for them.
 */
class PluginUpdateCheckService
{
    public const PLUGIN_DIRECTORY = '/plugins';

    /**
     * Jars larger than this are not pulled from the daemon for inspection.
     */
    private const MAX_JAR_BYTES = 100 * 1024 * 1024;

    public function __construct(
        private DaemonFileRepository $fileRepository,
        private PluginJarInspector $inspector,
        private PluginSourceResolver $resolver,
    ) {
    }

    /**
     * Refreshes the plugin index of a server from the daemon, then resolves updates for it.
     *
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function check(Server $server): Collection
    {
        $this->index($server);

        return $this->resolve(ServerPlugin::query()->where('server_id', $server->id)->get());
    }

    /**
     * Syncs the server_plugins rows with the jars currently in /plugins. Jars whose size and
     * mtime have not changed keep their cached metadata, and a jar already inspected on another
     * server under the same name and size is reused rather than downloaded again.
     *
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function index(Server $server): void
    {
        $listing = $this->fileRepository->setServer($server)->getDirectory(self::PLUGIN_DIRECTORY);

        $jars = collect($listing)
            ->filter(fn ($file) => ($file['file'] ?? false) && !($file['symlink'] ?? false) && str_ends_with(strtolower($file['name']), '.jar'))
            ->keyBy('name');

        $existing = ServerPlugin::query()->where('server_id', $server->id)->get()->keyBy('file_name');
        $blacklist = PluginUpdateRule::query()->where('type', PluginUpdateRule::TYPE_BLACKLIST)->get();

        ServerPlugin::query()
            ->where('server_id', $server->id)
            ->whereNotIn('file_name', $jars->keys()->all() ?: [''])
            ->delete();

        foreach ($jars as $name => $file) {
            /** @var ServerPlugin $row */
            $row = $existing->get($name) ?? new ServerPlugin(['server_id' => $server->id, 'file_name' => $name]);

            if ($row->exists && $row->sha1 && $row->file_size === (int) $file['size'] && $row->file_modified_at === $file['modified']) {
                continue;
            }

            $row->fill(['file_size' => (int) $file['size'], 'file_modified_at' => $file['modified']]);
            $row->fill(array_merge(array_fill_keys(ServerPlugin::resolutionFields(), null), ['status' => ServerPlugin::STATUS_PENDING]));

            // Blacklisted by file name: no need to pull the jar from the daemon at all.
            if (PluginUpdateRule::findFor($row, $blacklist)) {
                $row->fill(['sha1' => null, 'status' => ServerPlugin::STATUS_IGNORED])->save();

                continue;
            }

            $twin = ServerPlugin::query()
                ->where('file_name', $name)
                ->where('file_size', (int) $file['size'])
                ->whereNotNull('sha1')
                ->when($row->exists, fn ($query) => $query->where('id', '!=', $row->id))
                ->first();

            if ($twin) {
                $row->fill($twin->only(['sha1', 'plugin_key', 'plugin_name', 'plugin_version', 'plugin_platform', 'plugin_authors']));

                if (!$twin->plugin_key) {
                    $row->fill(['status' => ServerPlugin::STATUS_UNREADABLE, 'error' => $twin->error]);
                }
            } else {
                $this->inspectJar($server, $row);
            }

            $row->save();
        }
    }

    private function inspectJar(Server $server, ServerPlugin $row): void
    {
        $row->fill([
            'sha1' => null, 'plugin_key' => null, 'plugin_name' => null,
            'plugin_version' => null, 'plugin_platform' => null, 'plugin_authors' => null,
        ]);

        if ($row->file_size > self::MAX_JAR_BYTES) {
            $row->fill(['status' => ServerPlugin::STATUS_UNREADABLE, 'error' => 'Plik jest zbyt duży do sprawdzenia.']);

            return;
        }

        $temp = tempnam(sys_get_temp_dir(), 'plugin-jar-');

        try {
            $this->fileRepository->setServer($server)->downloadToFile(self::PLUGIN_DIRECTORY . '/' . $row->file_name, $temp);

            $row->sha1 = sha1_file($temp) ?: null;
            $meta = $this->inspector->inspect($temp);

            if (!$meta) {
                $row->fill(['status' => ServerPlugin::STATUS_UNREADABLE, 'error' => 'Brak plugin.yml w pliku jar.']);

                return;
            }

            $row->fill([
                'plugin_key' => PluginUpdateRule::keyFor($meta['name']),
                'plugin_name' => $meta['name'],
                'plugin_version' => $meta['version'],
                'plugin_platform' => $meta['platform'],
                'plugin_authors' => $meta['authors'],
            ]);
        } catch (\Throwable $exception) {
            $row->fill(['status' => ServerPlugin::STATUS_ERROR, 'error' => mb_substr($exception->getMessage(), 0, 1000)]);
        } finally {
            @unlink($temp);
        }
    }

    /**
     * Resolves upstream update information for the given rows and saves it.
     *
     * @param Collection<int, ServerPlugin> $plugins
     */
    public function resolve(Collection $plugins): Collection
    {
        $resolvable = $plugins->filter(fn (ServerPlugin $plugin) => $plugin->plugin_key && $plugin->sha1);

        $rules = PluginUpdateRule::query()->get();

        $hashes = [];
        try {
            $hashes = $this->resolver->lookupModrinthHashes($resolvable->pluck('sha1')->all());
        } catch (\Throwable) {
            // Fall through to name based lookups; a Modrinth outage should not fail the whole run.
        }

        foreach ($resolvable as $plugin) {
            $result = $this->resolver->resolve($plugin, PluginUpdateRule::findFor($plugin, $rules), $hashes[$plugin->sha1] ?? null);

            $plugin->fill($result + ['checked_at' => Carbon::now()])->save();
        }

        return $plugins;
    }
}
