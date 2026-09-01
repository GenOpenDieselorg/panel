<?php

namespace Pterodactyl\Http\Requests\Api\Client\Servers\Startup;

use Pterodactyl\Models\Permission;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class DownloadPaperMcRequest extends ClientApiRequest
{
    public function permission(): string
    {
        return Permission::ACTION_FILE_CREATE;
    }

    public function rules(): array
    {
        return [
            // Array syntax is required here: the pattern contains a pipe, which
            // Laravel would otherwise treat as a rule separator.
            'version' => ['required', 'string', 'max:20', 'regex:/^\d+\.\d+(?:\.\d+)?(?:-(?:pre|rc)-?\d+)?$/'],
        ];
    }
}
