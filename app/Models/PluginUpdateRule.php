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
}
