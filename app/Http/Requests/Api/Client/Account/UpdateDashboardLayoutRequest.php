<?php

namespace Pterodactyl\Http\Requests\Api\Client\Account;

use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class UpdateDashboardLayoutRequest extends ClientApiRequest
{
    public function authorize(): bool
    {
        return parent::authorize();
    }

    public function rules(): array
    {
        return array_merge(
            ['layout' => 'required|array'],
            $this->scopedLayoutRules('layout.own'),
            $this->scopedLayoutRules('layout.admin'),
        );
    }

    /**
     * @return array<string, string>
     */
    private function scopedLayoutRules(string $prefix): array
    {
        return [
            $prefix => 'required|array',
            "$prefix.sortMode" => 'required|string|in:custom,name_asc,name_desc',
            "$prefix.sections" => 'present|array',
            "$prefix.sections.*.id" => 'required|string|max:36',
            "$prefix.sections.*.name" => 'required|string|max:191',
            "$prefix.sections.*.serverUuids" => 'present|array',
            "$prefix.sections.*.serverUuids.*" => 'string|uuid',
            "$prefix.sections.*.trackPlugins" => 'sometimes|boolean',
            "$prefix.unsectionedOrder" => 'present|array',
            "$prefix.unsectionedOrder.*" => 'string|uuid',
            "$prefix.trackUnsectionedPlugins" => 'sometimes|boolean',
        ];
    }
}
