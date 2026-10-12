<?php

namespace Pterodactyl\Services\Plugins;

use Illuminate\Support\Arr;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\ServerPlugin;
use Pterodactyl\Models\PluginUpdateRule;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;

/**
 * Searches Modrinth and SpigotMC for Minecraft plugins compatible with a given game version and
 * installs them into a server's /plugins directory.
 */
class PluginStoreService
{
    private const BUKKIT_LOADERS = ['paper', 'spigot', 'bukkit', 'purpur', 'folia'];

    public function __construct(
        private DaemonFileRepository $fileRepository,
        private PluginJarInspector $inspector,
        private PluginSourceResolver $resolver,
        private PluginUpdateService $updateService,
        private PluginUpdateCheckService $checkService,
    ) {
    }

    /**
     * Reads the Minecraft version from the version_history.json that Paper and its forks keep in
     * the server root, e.g. {"currentVersion": "git-Paper-196 (MC: 1.21.8)"}.
     */
    public function detectGameVersion(Server $server): ?string
    {
        try {
            $json = json_decode($this->fileRepository->setServer($server)->getContent('/version_history.json', 65536), true);
        } catch (\Throwable) {
            return null;
        }

        return preg_match('/MC:\s*([0-9][0-9.]*)/', (string) ($json['currentVersion'] ?? ''), $m) ? $m[1] : null;
    }

    public function search(string $source, string $query, ?string $gameVersion): array
    {
        return $source === PluginSourceResolver::SOURCE_SPIGOT
            ? $this->searchSpigot($query, $gameVersion)
            : $this->searchModrinth($query, $gameVersion);
    }

    /**
     * Lists the installable versions of a project, newest first, limited to those built for the
     * given game version where the source records that.
     */
    public function versions(string $source, string $project, ?string $gameVersion): array
    {
        if ($source === PluginSourceResolver::SOURCE_SPIGOT) {
            $resource = $this->resolver->getJson(sprintf('%s/resources/%d', PluginSourceResolver::SPIGET_API, (int) $project));
            if (!$resource || !$this->spigotDownloadable($resource)) {
                return [];
            }

            $latest = $this->resolver->getJson(sprintf('%s/resources/%d/versions/latest', PluginSourceResolver::SPIGET_API, (int) $project));

            // Spiget can only serve the newest file of a resource, so there is exactly one choice.
            return [[
                'id' => (string) ($latest['id'] ?? 'latest'),
                'name' => $latest['name'] ?? 'latest',
                'type' => 'release',
                'published_at' => isset($latest['releaseDate']) ? date(DATE_ATOM, $latest['releaseDate']) : null,
                'game_versions' => $resource['testedVersions'] ?? [],
                'compatible' => $this->spigotCompatible($resource, $gameVersion),
            ]];
        }

        $query = ['loaders' => json_encode(self::BUKKIT_LOADERS)];
        if ($gameVersion) {
            $query['game_versions'] = json_encode([$gameVersion]);
        }

        $versions = $this->resolver->getJson(PluginSourceResolver::MODRINTH_API . '/project/' . rawurlencode($project) . '/version', $query) ?? [];

        return array_values(array_map(fn ($v) => [
            'id' => $v['id'],
            'name' => $v['version_number'],
            'type' => $v['version_type'],
            'published_at' => $v['date_published'],
            'game_versions' => $v['game_versions'] ?? [],
            'compatible' => true,
        ], array_slice(array_filter($versions, fn ($v) => $this->modrinthJar($v) !== null), 0, 30)));
    }

    /**
     * Downloads the chosen version, checks it is a plugin that is not installed yet, and writes it
     * into /plugins.
     *
     * @throws DisplayException
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function install(Server $server, string $source, string $project, ?string $versionId): array
    {
        if ($source === PluginSourceResolver::SOURCE_SPIGOT) {
            $resource = $this->resolver->getJson(sprintf('%s/resources/%d', PluginSourceResolver::SPIGET_API, (int) $project));
            if (!$resource || !$this->spigotDownloadable($resource)) {
                throw new DisplayException('This resource cannot be downloaded automatically (premium or external link).');
            }

            $url = sprintf('%s/resources/%d/download', PluginSourceResolver::SPIGET_API, (int) $project);
            $fileName = null;
        } else {
            $version = $versionId ? $this->resolver->getJson(PluginSourceResolver::MODRINTH_API . '/version/' . rawurlencode($versionId)) : null;
            $file = $version ? $this->modrinthJar($version) : null;

            if (!$file || ($version['project_id'] ?? null) !== $this->modrinthProjectId($project)) {
                throw new DisplayException('The selected version was not found on Modrinth.');
            }

            $url = $file['url'];
            $fileName = $file['filename'];
        }

        $temp = tempnam(sys_get_temp_dir(), 'plugin-install-');

        try {
            $this->updateService->download($url, $temp);

            $meta = $this->inspector->inspect($temp);
            if (!$meta) {
                throw new DisplayException('The downloaded file is not a Minecraft plugin (no plugin.yml).');
            }

            $this->checkService->index($server);

            $installed = ServerPlugin::query()
                ->where('server_id', $server->id)
                ->where('plugin_key', PluginUpdateRule::keyFor($meta['name']))
                ->first();

            if ($installed) {
                throw new DisplayException(sprintf(
                    '%s is already installed (%s, version %s). Update it instead of installing it again.',
                    $meta['name'],
                    $installed->file_name,
                    $installed->plugin_version
                ));
            }

            $fileName = $this->resolver->safeFileName($fileName ?: sprintf('%s-%s.jar', $meta['name'], $meta['version']));
            $existing = collect($this->fileRepository->setServer($server)->getDirectory(PluginUpdateCheckService::PLUGIN_DIRECTORY))->pluck('name');
            if ($existing->contains($fileName)) {
                throw new DisplayException("$fileName already exists in /plugins.");
            }

            $this->fileRepository->writeFile(PluginUpdateCheckService::PLUGIN_DIRECTORY . '/' . $fileName, $temp);
        } finally {
            @unlink($temp);
        }

        $this->checkService->index($server);
        $this->checkService->resolve(ServerPlugin::query()->where('server_id', $server->id)->where('file_name', $fileName)->get());

        return ['file_name' => $fileName, 'plugin_name' => $meta['name'], 'plugin_version' => $meta['version']];
    }

    private function searchModrinth(string $query, ?string $gameVersion): array
    {
        $facets = [['project_type:plugin'], array_map(fn ($l) => "categories:$l", self::BUKKIT_LOADERS)];
        if ($gameVersion) {
            $facets[] = ["versions:$gameVersion"];
        }

        $hits = $this->resolver->getJson(PluginSourceResolver::MODRINTH_API . '/search', [
            'query' => $query,
            'facets' => json_encode($facets),
            'limit' => 20,
        ])['hits'] ?? [];

        return array_map(fn ($hit) => [
            'source' => PluginSourceResolver::SOURCE_MODRINTH,
            'project' => $hit['project_id'],
            'title' => $hit['title'],
            'description' => $hit['description'] ?? '',
            'author' => $hit['author'] ?? null,
            'downloads' => $hit['downloads'] ?? 0,
            'icon_url' => $hit['icon_url'] ?: null,
            'url' => 'https://modrinth.com/plugin/' . $hit['slug'],
            'compatible' => true,
        ], $hits);
    }

    private function searchSpigot(string $query, ?string $gameVersion): array
    {
        $hits = $this->resolver->getJson(sprintf('%s/search/resources/%s', PluginSourceResolver::SPIGET_API, rawurlencode($query)), [
            'field' => 'name',
            'size' => 30,
            'sort' => '-downloads',
            'fields' => 'id,name,tag,downloads,premium,external,file,testedVersions,icon,author',
        ]) ?? [];

        $results = [];
        foreach (is_array($hits) ? $hits : [] as $hit) {
            if (!isset($hit['id']) || !$this->spigotDownloadable($hit)) {
                continue;
            }

            $results[] = [
                'source' => PluginSourceResolver::SOURCE_SPIGOT,
                'project' => (string) $hit['id'],
                'title' => $hit['name'],
                'description' => $hit['tag'] ?? '',
                'author' => null,
                'downloads' => $hit['downloads'] ?? 0,
                'icon_url' => !empty($hit['icon']['url']) ? 'https://www.spigotmc.org/' . $hit['icon']['url'] : null,
                'url' => sprintf('https://www.spigotmc.org/resources/%d/', $hit['id']),
                'compatible' => $this->spigotCompatible($hit, $gameVersion),
            ];
        }

        return array_slice($results, 0, 20);
    }

    private function spigotDownloadable(array $resource): bool
    {
        return empty($resource['premium']) && empty($resource['external']) && ($resource['file']['type'] ?? '.jar') === '.jar';
    }

    /**
     * SpigotMC only records the major versions a resource was tested on ("1.21"), so 1.21.8 counts
     * as compatible with a resource tested on 1.21.
     */
    private function spigotCompatible(array $resource, ?string $gameVersion): ?bool
    {
        $tested = $resource['testedVersions'] ?? [];
        if (!$gameVersion || !$tested) {
            return null;
        }

        $major = implode('.', array_slice(explode('.', $gameVersion), 0, 2));

        return in_array($gameVersion, $tested, true) || in_array($major, $tested, true);
    }

    private function modrinthJar(array $version): ?array
    {
        $files = array_filter($version['files'] ?? [], fn ($f) => str_ends_with(strtolower($f['filename'] ?? ''), '.jar'));

        return Arr::first($files, fn ($f) => !empty($f['primary'])) ?? Arr::first($files);
    }

    private function modrinthProjectId(string $project): ?string
    {
        return $this->resolver->getJson(PluginSourceResolver::MODRINTH_API . '/project/' . rawurlencode($project))['id'] ?? null;
    }
}
