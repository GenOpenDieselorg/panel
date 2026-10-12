<?php

namespace Pterodactyl\Services\Plugins;

use ZipArchive;
use Symfony\Component\Yaml\Yaml;

/**
 * Reads the plugin descriptor out of a local plugin jar.
 */
class PluginJarInspector
{
    /**
     * Descriptor files in order of preference, mapped to the platform they imply.
     */
    private const DESCRIPTORS = [
        'paper-plugin.yml' => 'paper',
        'plugin.yml' => 'bukkit',
        'bungee.yml' => 'bungeecord',
        'velocity-plugin.json' => 'velocity',
    ];

    /**
     * Returns the plugin's name, version, authors and platform, or null if the jar holds no
     * recognisable descriptor.
     *
     * @return array{name: string, version: string, authors: string[], platform: string}|null
     */
    public function inspect(string $path): ?array
    {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::RDONLY) !== true) {
            return null;
        }

        try {
            foreach (self::DESCRIPTORS as $file => $platform) {
                $contents = $zip->getFromName($file);
                if ($contents === false) {
                    continue;
                }

                $data = $this->parse($file, $contents);
                if (!is_array($data) || empty($data['name']) || !isset($data['version'])) {
                    continue;
                }

                // Velocity calls the display name "name" but the id is what matters for matching.
                $name = $platform === 'velocity' ? ($data['name'] ?? $data['id']) : $data['name'];

                return [
                    'name' => mb_substr(trim((string) $name), 0, 191),
                    'version' => mb_substr(trim((string) $data['version']), 0, 191),
                    'authors' => $this->authors($data),
                    'platform' => $platform,
                ];
            }
        } finally {
            $zip->close();
        }

        return null;
    }

    private function parse(string $file, string $contents): mixed
    {
        try {
            if (str_ends_with($file, '.json')) {
                return json_decode($contents, true);
            }

            // Build tools sometimes leave unresolved placeholders such as ${project.version}
            // behind, which are still valid YAML scalars, so a plain parse is enough here.
            return Yaml::parse($contents);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * @return string[]
     */
    private function authors(array $data): array
    {
        $authors = [];

        foreach (['author', 'authors'] as $key) {
            $value = $data[$key] ?? null;

            if (is_string($value)) {
                $authors[] = $value;
            } elseif (is_array($value)) {
                $authors = array_merge($authors, array_filter($value, 'is_string'));
            }
        }

        return array_values(array_unique(array_map('trim', $authors)));
    }
}
