<?php

namespace Pterodactyl\Http\Requests\Api\Client\Servers\Plugins;

use Pterodactyl\Models\Permission;
use Pterodactyl\Contracts\Http\ClientPermissionsRequest;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class UpdatePluginRequest extends ClientApiRequest implements ClientPermissionsRequest
{
    /**
     * Updating swaps the jar out, so the user also needs to be allowed to delete files.
     */
    public function authorize(): bool
    {
        return parent::authorize() && $this->user()->can(Permission::ACTION_FILE_DELETE, $this->route()->parameter('server'));
    }

    public function permission(): string
    {
        return Permission::ACTION_FILE_CREATE;
    }

    public function rules(): array
    {
        return [
            'file' => 'required|string|max:191',
        ];
    }
}
