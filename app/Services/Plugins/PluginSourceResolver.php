<?php

namespace Pterodactyl\Services\Plugins;

use Carbon\Carbon;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\PendingRequest;
use Pterodactyl\Models\ServerPlugin;
use Pterodactyl\Models\PluginUpdateRule;

/**
 * Finds the upstream project for an installed plugin on Modrinth or SpigotMC (through the Spiget
 * API) and works out whether a newer, downloadable version exists.
 *
 * A plugin only counts as identified when the installed version itself can be found upstream:
 * an exact SHA-1 match on Modrinth, or a project of the same name that lists the installed version.
 * That keeps same-named plugins by other authors from being offered as updates. Admins can still
 * pin a plugin to a specific project with a link rule, which skips the version check.
 */
class PluginSourceResolver
{
    public const SOURCE_MODRINTH = 'modrinth';
    public const SOURCE_SPIGOT = 'spigot';

    public const MODRINTH_API = 'https://api.modrinth.com/v2';
    public const SPIGET_API = 'https://api.spiget.org/v2';

    public const LOADERS = [
        'bukkit' => ['paper', 'spigot', 'bukkit', 'purpur', 'folia'],
        'paper' => ['paper', 'purpur', 'folia'],
        'bungeecord' => ['bungeecord', 'waterfall'],
        'velocity' => ['velocity'],
    ];

    /** @var array<string, array> */
    private array $memo = [];

    /** @var array<string, mixed> */
    private array $requestCache = [];

    /**
     * Looks up installed jars on Modrinth by SHA-1 in bulk.
     *
     * @param string[] $hashes
     *
     * @return array<string, array> Modrinth version objects keyed by hash
     */
    public function lookupModrinthHashes(array $hashes): array
    {
        $found = [];

        foreach (array_chunk(array_values(array_unique(array_filter($hashes))), 100) as $chunk) {
            $response = $this->http()->post(self::MODRINTH_API . '/version_files', [
                'hashes' => $chunk,
                'algorithm' => 'sha1',
            ]);

            if ($response->successful()) {
                $found = array_merge($found, $response->json() ?: []);
            }
        }

        return $found;
    }

    /**
     * Parses a Modrinth or SpigotMC project link into a source and project id.
     *
     * @return array{source: string, project_id: string}|null
     */
    public function parseProjectUrl(string $url): ?array
    {
        $url = trim($url);

        if (preg_match('#modrinth\.com/(?:plugin|mod|project|datapack)/([A-Za-z0-9_.-]+)#i', $url, $m)) {
            $project = $this->modrinthProject($m[1]);

            return $project ? ['source' => self::SOURCE_MODRINTH, 'project_id' => $project['id']] : null;
        }

        if (preg_match('#spigotmc\.org/resources/(?:[^/]*\.)?(\d+)#i', $url, $m)) {
            return $this->spigetResource((int) $m[1]) ? ['source' => self::SOURCE_SPIGOT, 'project_id' => $m[1]] : null;
        }

        return null;
    }

    /**
     * Resolves the update state for a plugin.
     *
     * @param array|null $hashVersion the Modrinth version matching the jar's hash, if any
     *
     * @return array<string, mixed> attributes for {@see ServerPlugin}
     */
    public function resolve(ServerPlugin $plugin, ?PluginUpdateRule $rule, ?array $hashVersion): array
    {
        if ($rule?->type === PluginUpdateRule::TYPE_BLACKLIST) {
            return $this->result(ServerPlugin::STATUS_IGNORED);
        }

        $key = implode('|', [
            $rule?->id, $rule?->updated_at?->timestamp, $plugin->plugin_platform, $plugin->plugin_key,
            $plugin->plugin_version, $hashVersion['id'] ?? null,
        ]);

        return $this->memo[$key] ??= $this->doResolve($plugin, $rule, $hashVersion);
    }

    private function doResolve(ServerPlugin $plugin, ?PluginUpdateRule $rule, ?array $hashVersion): array
    {
        try {
            if ($rule?->type === PluginUpdateRule::TYPE_LINK) {
                return $rule->source === self::SOURCE_MODRINTH
                    ? $this->resolveModrinth($plugin, $rule->project_id, $hashVersion, true)
                    : $this->resolveSpigot($plugin, (int) $rule->project_id, true);
            }

            if ($hashVersion) {
                return $this->resolveModrinth($plugin, $hashVersion['project_id'], $hashVersion, false);
            }

            foreach ($this->searchModrinth($plugin->plugin_name) as $projectId) {
                $result = $this->resolveModrinth($plugin, $projectId, null, false);
                if ($result['status'] !== ServerPlugin::STATUS_NOT_FOUND) {
                    return $result;
                }
            }

            foreach ($this->searchSpigot($plugin->plugin_name) as $resourceId) {
                $result = $this->resolveSpigot($plugin, $resourceId, false);
                if ($result['status'] !== ServerPlugin::STATUS_NOT_FOUND) {
                    return $result;
                }
            }

            return $this->result(ServerPlugin::STATUS_NOT_FOUND);
        } catch (\Throwable $exception) {
            return $this->result(ServerPlugin::STATUS_ERROR, ['error' => mb_substr($exception->getMessage(), 0, 1000)]);
        }
    }

    private function resolveModrinth(ServerPlugin $plugin, string $projectId, ?array $current, bool $pinned): array
    {
        $project = $this->modrinthProject($projectId);
        if (!$project) {
            return $this->result(ServerPlugin::STATUS_NOT_FOUND);
        }

        $versions = $this->modrinthVersions($project['id'], $plugin->plugin_platform);

        if ($current && ($current['project_id'] ?? null) !== $project['id']) {
            $current = null;
        }

        $current ??= Arr::first($versions, fn ($v) => $this->versionsMatch($v['version_number'] ?? '', $plugin->plugin_version));

        if (!$current && !$pinned) {
            return $this->result(ServerPlugin::STATUS_NOT_FOUND);
        }

        $base = [
            'source' => self::SOURCE_MODRINTH,
            'project_id' => $project['id'],
            'project_title' => $project['title'] ?? null,
            'project_url' => sprintf('https://modrinth.com/plugin/%s', $project['slug']),
        ];

        $latest = $this->pickLatestModrinth($versions, $current['version_type'] ?? 'release');
        if (!$latest) {
            return $this->result(ServerPlugin::STATUS_NOT_DOWNLOADABLE, $base);
        }

        $file = Arr::first($latest['files'] ?? [], fn ($f) => !empty($f['primary'])) ?? ($latest['files'][0] ?? null);

        $base += [
            'latest_version' => $latest['version_number'],
            'latest_version_id' => $latest['id'],
            'latest_game_versions' => $latest['game_versions'] ?? [],
        ];

        if (!$file || !str_ends_with(strtolower($file['filename'] ?? ''), '.jar')) {
            return $this->result(ServerPlugin::STATUS_NOT_DOWNLOADABLE, $base);
        }

        $isNewer = $current
            ? $latest['id'] !== $current['id'] && Carbon::parse($latest['date_published'])->gt(Carbon::parse($current['date_published']))
            : !$this->versionsMatch($latest['version_number'], $plugin->plugin_version);

        return $this->result($isNewer ? ServerPlugin::STATUS_UPDATE_AVAILABLE : ServerPlugin::STATUS_UP_TO_DATE, $base + [
            'download_url' => $file['url'],
            'download_file_name' => $file['filename'],
        ]);
    }

    private function resolveSpigot(ServerPlugin $plugin, int $resourceId, bool $pinned): array
    {
        $resource = $this->spigetResource($resourceId);
        if (!$resource) {
            return $this->result(ServerPlugin::STATUS_NOT_FOUND);
        }

        $versions = $this->spigetVersions($resourceId);
        $current = Arr::first($versions, fn ($v) => $this->versionsMatch($v['name'] ?? '', $plugin->plugin_version));

        if (!$current && !$pinned) {
            return $this->result(ServerPlugin::STATUS_NOT_FOUND);
        }

        $latest = $versions[0] ?? null;

        $base = [
            'source' => self::SOURCE_SPIGOT,
            'project_id' => (string) $resourceId,
            'project_title' => $resource['name'] ?? null,
            'project_url' => sprintf('https://www.spigotmc.org/resources/%d/', $resourceId),
            'latest_version' => $latest['name'] ?? null,
            'latest_version_id' => isset($latest['id']) ? (string) $latest['id'] : null,
            'latest_game_versions' => $resource['testedVersions'] ?? [],
        ];

        // Premium and externally hosted resources cannot be fetched without a browser session.
        if (!$latest || !empty($resource['premium']) || !empty($resource['external'])
            || ($resource['file']['type'] ?? '.jar') !== '.jar') {
            return $this->result(ServerPlugin::STATUS_NOT_DOWNLOADABLE, $base);
        }

        $isNewer = $current
            ? $latest['id'] !== $current['id'] && $latest['releaseDate'] > $current['releaseDate']
            : !$this->versionsMatch($latest['name'], $plugin->plugin_version);

        return $this->result($isNewer ? ServerPlugin::STATUS_UPDATE_AVAILABLE : ServerPlugin::STATUS_UP_TO_DATE, $base + [
            'download_url' => sprintf('%s/resources/%d/download', self::SPIGET_API, $resourceId),
            'download_file_name' => $this->safeFileName(sprintf('%s-%s.jar', $plugin->plugin_name, $latest['name'])),
        ]);
    }

    /**
     * Prefers a release build, unless the installed build is itself a beta or alpha.
     */
    private function pickLatestModrinth(array $versions, string $currentType): ?array
    {
        if ($currentType !== 'release') {
            return $versions[0] ?? null;
        }

        return Arr::first($versions, fn ($v) => ($v['version_type'] ?? 'release') === 'release') ?? ($versions[0] ?? null);
    }

    /**
     * @return string[] project ids whose title or slug is the plugin's name
     */
    private function searchModrinth(string $name): array
    {
        $hits = $this->getJson(self::MODRINTH_API . '/search', [
            'query' => $name,
            'facets' => json_encode([['project_type:plugin']]),
            'limit' => 10,
        ])['hits'] ?? [];

        $wanted = $this->normaliseName($name);

        return array_slice(array_values(array_map(fn ($hit) => $hit['project_id'], array_filter(
            $hits,
            fn ($hit) => $this->normaliseName($hit['title'] ?? '') === $wanted || $this->normaliseName($hit['slug'] ?? '') === $wanted
        ))), 0, 3);
    }

    /**
     * @return int[] resource ids whose title is the plugin's name
     */
    private function searchSpigot(string $name): array
    {
        $hits = $this->getJson(sprintf('%s/search/resources/%s', self::SPIGET_API, rawurlencode($name)), [
            'field' => 'name',
            'size' => 15,
            'sort' => '-downloads',
            'fields' => 'id,name',
        ]) ?? [];

        $wanted = $this->normaliseName($name);

        return array_slice(array_values(array_map(fn ($hit) => (int) $hit['id'], array_filter(
            is_array($hits) ? $hits : [],
            fn ($hit) => isset($hit['id']) && $this->normaliseName($this->cleanSpigotTitle($hit['name'] ?? '')) === $wanted
        ))), 0, 5);
    }

    private function modrinthProject(string $idOrSlug): ?array
    {
        return $this->getJson(self::MODRINTH_API . '/project/' . rawurlencode($idOrSlug));
    }

    private function modrinthVersions(string $projectId, ?string $platform): array
    {
        $loaders = self::LOADERS[$platform ?? 'bukkit'] ?? self::LOADERS['bukkit'];

        $versions = $this->getJson(self::MODRINTH_API . "/project/$projectId/version", [
            'loaders' => json_encode($loaders),
        ]);

        return is_array($versions) && $versions ? $versions : ($this->getJson(self::MODRINTH_API . "/project/$projectId/version") ?? []);
    }

    private function spigetResource(int $id): ?array
    {
        $resource = $this->getJson(sprintf('%s/resources/%d', self::SPIGET_API, $id));

        return isset($resource['id']) ? $resource : null;
    }

    /**
     * @return array<int, array{id: int, name: string, releaseDate: int}> newest first
     */
    private function spigetVersions(int $id): array
    {
        $versions = $this->getJson(sprintf('%s/resources/%d/versions', self::SPIGET_API, $id), [
            'size' => 1000,
            'sort' => '-releaseDate',
            'fields' => 'id,name,releaseDate',
        ]);

        return is_array($versions) ? array_values(array_filter($versions, fn ($v) => isset($v['id'], $v['name']))) : [];
    }

    public function getJson(string $url, array $query = []): ?array
    {
        $cacheKey = $url . '?' . http_build_query($query);
        if (array_key_exists($cacheKey, $this->requestCache)) {
            return $this->requestCache[$cacheKey];
        }

        $response = $this->http()->get($url, $query);

        if ($response->status() === 404) {
            return $this->requestCache[$cacheKey] = null;
        }

        if (!$response->successful()) {
            throw new \RuntimeException(sprintf('%s returned HTTP %d', parse_url($url, PHP_URL_HOST), $response->status()));
        }

        return $this->requestCache[$cacheKey] = $response->json();
    }

    public function http(): PendingRequest
    {
        return Http::withUserAgent(sprintf('GenOpenDiesel/panel/%s (%s)', config('app.version'), config('app.url')))
            ->acceptJson()
            ->timeout(20)
            ->retry(3, fn (int $attempt) => $attempt * 3000, fn ($exception) => $exception instanceof \Illuminate\Http\Client\ConnectionException
                || in_array($exception->response?->status(), [429, 500, 502, 503, 504], true), false);
    }

    /**
     * Compares version strings loosely: "v2.1.0" matches "2.1.0", and "2.1.0" matches
     * "2.1.0-paper" or "Build 2.1.0", but "2.1" does not match "2.1.0".
     */
    public function versionsMatch(string $a, string $b): bool
    {
        $a = $this->normaliseVersion($a);
        $b = $this->normaliseVersion($b);

        if ($a === '' || $b === '') {
            return false;
        }

        if ($a === $b) {
            return true;
        }

        foreach ([[$a, $b], [$b, $a]] as [$haystack, $needle]) {
            if (strlen($needle) >= 3 && preg_match('/(?<![0-9a-z]|[0-9]\.)' . preg_quote($needle, '/') . '(?![0-9]|\.[0-9])/', $haystack)) {
                return true;
            }
        }

        return false;
    }

    private function normaliseVersion(string $version): string
    {
        return preg_replace('/^v(?=\d)/', '', mb_strtolower(trim($version)));
    }

    private function normaliseName(string $name): string
    {
        return preg_replace('/[^a-z0-9]/', '', mb_strtolower($name));
    }

    /**
     * Spigot titles often carry a tagline: "EssentialsX | The essential plugin" or "Foo [1.8-1.21]".
     */
    private function cleanSpigotTitle(string $title): string
    {
        return trim(preg_split('/\s*(?:\||\s-\s|–|—|\[|\(|:)/u', $title, 2)[0] ?? $title);
    }

    public function safeFileName(string $name): string
    {
        return preg_replace('/[^A-Za-z0-9._+-]+/', '_', $name);
    }

    private function result(string $status, array $attributes = []): array
    {
        return array_merge(array_fill_keys(ServerPlugin::resolutionFields(), null), $attributes, ['status' => $status]);
    }
}
