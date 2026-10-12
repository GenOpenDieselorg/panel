<?php

namespace Pterodactyl\Models;

use Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * @property int $id
 * @property int $user_id
 * @property int $server_id
 * @property string $name
 */
class ServerNickname extends EloquentModel
{
    protected $table = 'server_nicknames';

    protected $guarded = ['id', 'created_at', 'updated_at'];
}
