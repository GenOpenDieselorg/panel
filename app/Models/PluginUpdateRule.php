<?php

namespace Pterodactyl\Models;

use Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * @property int $id
 * @property string $plugin_key
 * @property string $plugin_name
 * @property string $type
 * @property string|null $source
 * @property string|null $project_id
 * @property string|null $project_url
 * @property int|null $created_by
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 */
class PluginUpdateRule extends EloquentModel
{
    public const TYPE_BLACKLIST = 'blacklist';
    public const TYPE_LINK = 'link';

    protected $table = 'plugin_update_rules';

    protected $guarded = ['id', 'created_at', 'updated_at'];

    public static function keyFor(string $pluginName): string
    {
        return mb_strtolower(trim($pluginName));
    }

    /**
     * Reduces a plugin or jar name to lowercase letters and digits, which is what blacklist
     * patterns are matched against: "ChestSorter-v1.2 (3).jar" becomes "chestsorterv123".
     */
    public static function normalise(string $name): string
    {
        return preg_replace('/[^a-z0-9]/', '', mb_strtolower(preg_replace('/\.jar$/i', '', trim($name))));
    }

    /**
     * Blacklist rules are stored under a prefixed key so they can coexist with a link rule for
     * the same plugin name.
     */
    public static function blacklistKey(string $pattern): string
    {
        return 'bl:' . $pattern;
    }

    /**
     * The prefix a blacklist rule matches, e.g. "chestsorter" for "chestsorter*".
     */
    public function pattern(): ?string
    {
        return $this->type === self::TYPE_BLACKLIST ? substr($this->plugin_key, 3) : null;
    }

    /**
     * A blacklist rule matches every plugin whose plugin.yml name or jar file name starts with its
     * pattern, whatever the version. A link rule matches the exact plugin name.
     */
    public function matches(ServerPlugin $plugin): bool
    {
        if ($this->type === self::TYPE_BLACKLIST) {
            $pattern = $this->pattern();

            return str_starts_with(self::normalise($plugin->plugin_name ?? ''), $pattern)
                || str_starts_with(self::normalise($plugin->file_name), $pattern);
        }

        return $plugin->plugin_key !== null && $plugin->plugin_key === $this->plugin_key;
    }

    /**
     * Finds the rule that applies to a plugin. A blacklist always wins over a link.
     *
     * @param \Illuminate\Support\Collection<int, self> $rules
     */
    public static function findFor(ServerPlugin $plugin, $rules): ?self
    {
        return $rules->first(fn (self $rule) => $rule->type === self::TYPE_BLACKLIST && $rule->matches($plugin))
            ?? $rules->first(fn (self $rule) => $rule->type === self::TYPE_LINK && $rule->matches($plugin));
    }
}
