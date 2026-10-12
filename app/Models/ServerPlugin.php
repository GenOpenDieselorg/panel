<?php

namespace Pterodactyl\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * @property int $id
 * @property int $server_id
 * @property string $file_name
 * @property int $file_size
 * @property string|null $file_modified_at
 * @property string|null $sha1
 * @property string|null $plugin_key
 * @property string|null $plugin_name
 * @property string|null $plugin_version
 * @property string|null $plugin_platform
 * @property string[]|null $plugin_authors
 * @property string $status
 * @property string|null $source
 * @property string|null $project_id
 * @property string|null $project_title
 * @property string|null $project_url
 * @property string|null $latest_version
 * @property string|null $latest_version_id
 * @property string|null $download_url
 * @property string|null $download_file_name
 * @property string[]|null $latest_game_versions
 * @property string|null $error
 * @property \Carbon\Carbon|null $checked_at
 * @property Server $server
 */
class ServerPlugin extends EloquentModel
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_UPDATE_AVAILABLE = 'update_available';
    public const STATUS_UP_TO_DATE = 'up_to_date';
    public const STATUS_NOT_FOUND = 'not_found';
    public const STATUS_NOT_DOWNLOADABLE = 'not_downloadable';
    public const STATUS_IGNORED = 'ignored';
    public const STATUS_UNREADABLE = 'unreadable';
    public const STATUS_ERROR = 'error';

    protected $table = 'server_plugins';

    protected $guarded = ['id', 'created_at', 'updated_at'];

    protected $casts = [
        'file_size' => 'integer',
        'plugin_authors' => 'array',
        'latest_game_versions' => 'array',
        'checked_at' => 'datetime',
    ];

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class);
    }

    /**
     * Upstream lookup fields, cleared whenever a plugin is re-resolved.
     */
    public static function resolutionFields(): array
    {
        return [
            'status', 'source', 'project_id', 'project_title', 'project_url', 'latest_version',
            'latest_version_id', 'download_url', 'download_file_name', 'latest_game_versions', 'error',
        ];
    }
}
