<?php

namespace Pterodactyl\Http\Requests\Api\Client\Servers\Plugins;

use Pterodactyl\Models\Permission;
use Pterodactyl\Contracts\Http\ClientPermissionsRequest;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class PluginStoreRequest extends ClientApiRequest implements ClientPermissionsRequest
{
    public function permission(): string
    {
        return Permission::ACTION_FILE_CREATE;
    }

    public function rules(): array
    {
        return [
            'source' => 'sometimes|in:modrinth,spigot',
            'query' => 'sometimes|nullable|string|max:100',
            'project' => 'sometimes|string|max:64',
            'version' => 'sometimes|nullable|string|max:64',
            'game_version' => ['sometimes', 'nullable', 'string', 'regex:/^\d+\.\d+(\.\d+)?$/'],
        ];
    }
}
