<?php

namespace Pterodactyl\Http\Requests\Api\Client\Servers\Backups;

use Pterodactyl\Models\Permission;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class BackupCloneCleanupRequest extends ClientApiRequest
{
    public function permission(): string
    {
        return Permission::ACTION_FILE_DELETE;
    }

    public function rules(): array
    {
        return [
            'mode' => 'sometimes|string|in:remove,keep',
            'plugins' => 'present|array|max:500',
            'plugins.*' => [
                'string',
                'max:255',
                'not_regex:/[\/\\\\]/',
                'not_regex:/\.\./',
            ],
            'patterns' => 'sometimes|array|max:100',
            'patterns.*' => [
                'string',
                'max:255',
                'not_regex:/[\/\\\\]/',
                'not_regex:/\.\./',
            ],
        ];
    }
}
