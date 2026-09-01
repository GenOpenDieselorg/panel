<?php

namespace Pterodactyl\Services\Servers;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

class PaperMcService
{
    /**
     * The v2 API was sunset by PaperMC and now returns HTTP 410 — everything
     * goes through the Fill (v3) API instead.
     */
    private const API_BASE = 'https://fill.papermc.io/v3/projects/paper';

    private const VERSION_CACHE_KEY = 'papermc:paper:versions';

    /**
     * Oldest legacy (1.x) release offered for download — anything below 1.20 is
     * dropped from the list. Versions on the new scheme (26.1.2) are always newer.
     */
    private const MINIMUM_LEGACY_MINOR = 20;

    /**
     * Returns the stable Minecraft versions Paper publishes, newest first, limited
     * to 1.20 and up. Both the legacy (1.21.11) and the new (26.1.2) version
     * schemes are included.
     *
     * @return string[]
     */
    public function getVersions(): array
    {
        return Cache::remember(self::VERSION_CACHE_KEY, now()->addMinutes(15), function () {
            $response = $this->request()->get(self::API_BASE);

            if (!$response->successful()) {
                throw new BadRequestHttpException('Unable to fetch PaperMC versions at this time.');
            }

            $versions = $this->flattenVersions($response->json('versions'));

            if (empty($versions)) {
                throw new BadRequestHttpException('PaperMC returned an empty version list.');
            }

            return $versions;
        });
    }

    /**
     * @return array{version: string, build: int, download_url: string, file_name: string}
     */
    public function getLatestBuildDownload(string $version): array
    {
        if (!$this->isValidVersion($version)) {
            throw new BadRequestHttpException('The selected PaperMC version is invalid.');
        }

        $response = $this->request()
            ->get(self::API_BASE . '/versions/' . rawurlencode($version) . '/builds/latest');

        if (!$response->successful()) {
            throw new BadRequestHttpException('The selected PaperMC version was not found.');
        }

        $download = $response->json('downloads.server:default');
        if (!is_array($download)) {
            throw new BadRequestHttpException('No server download was found for the selected PaperMC version.');
        }

        $downloadName = $download['name'] ?? null;
        if (!is_string($downloadName) || $downloadName === '' || !$this->isSafeFileName($downloadName)) {
            throw new BadRequestHttpException('PaperMC returned an invalid download file name.');
        }

        $downloadUrl = $download['url'] ?? null;
        if (!is_string($downloadUrl) || !str_starts_with($downloadUrl, 'https://')) {
            throw new BadRequestHttpException('PaperMC returned an invalid download URL.');
        }

        return [
            'version' => $version,
            'build' => (int) ($response->json('id') ?? 0),
            'download_url' => $downloadUrl,
            'file_name' => $downloadName,
        ];
    }

    /**
     * Downloads a PaperMC build to a temporary file on the panel server.
     *
     * @throws BadRequestHttpException
     */
    public function downloadToTemporaryFile(string $url): string
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'paper_');
        if ($tempPath === false) {
            throw new BadRequestHttpException('Unable to create a temporary download file.');
        }

        $response = Http::timeout(900)
            ->withHeaders(['User-Agent' => 'Pterodactyl Panel'])
            ->sink($tempPath)
            ->get($url);

        if (!$response->successful()) {
            @unlink($tempPath);

            throw new BadRequestHttpException('Unable to download the PaperMC build.');
        }

        if (!is_file($tempPath) || filesize($tempPath) === 0) {
            @unlink($tempPath);

            throw new BadRequestHttpException('The downloaded PaperMC build was empty.');
        }

        return $tempPath;
    }

    public function isValidVersion(string $version): bool
    {
        return (bool) preg_match('/^\d+\.\d+(?:\.\d+)?(?:-(?:pre|rc)-?\d+)?$/', $version);
    }

    public function isSafeFileName(string $name): bool
    {
        return $name !== ''
            && !str_contains($name, '/')
            && !str_contains($name, '\\')
            && !str_contains($name, '..');
    }

    /**
     * Legacy 1.x releases are kept from 1.20 upwards. The new date-based scheme
     * (26.1, 26.2, …) starts well past that, so those always pass.
     */
    private function isSupportedVersion(string $version): bool
    {
        [$major, $minor] = array_pad(array_map('intval', explode('.', $version, 3)), 2, 0);

        return $major > 1 || $minor >= self::MINIMUM_LEGACY_MINOR;
    }

    private function request(): \Illuminate\Http\Client\PendingRequest
    {
        return Http::timeout(15)
            ->acceptJson()
            ->withHeaders(['User-Agent' => 'Pterodactyl Panel']);
    }

    /**
     * Fill groups versions by release family, e.g.
     * {"26.2": ["26.2", "26.2-rc-2"], "26.1": ["26.1.2", "26.1.1"], ...}
     * Families and their members both arrive newest first, so the flattened
     * list keeps that ordering. Pre-releases and release candidates are dropped.
     *
     * @return string[]
     */
    private function flattenVersions(mixed $versions): array
    {
        if (!is_array($versions)) {
            return [];
        }

        $flattened = [];

        foreach ($versions as $family) {
            foreach ((array) $family as $version) {
                if (!is_string($version) || str_contains($version, '-')) {
                    continue;
                }

                if ($this->isValidVersion($version) && $this->isSupportedVersion($version)) {
                    $flattened[] = $version;
                }
            }
        }

        return array_values(array_unique($flattened));
    }
}
