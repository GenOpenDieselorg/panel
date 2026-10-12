<?php

namespace Pterodactyl\Http\Controllers\Api\Client\Servers;

use Illuminate\Http\Request;
use Pterodactyl\Models\Server;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Models\ServerNickname;
use Pterodactyl\Http\Controllers\Api\Client\ClientApiController;

/**
 * Lets any user who can see a server give it a private name, shown only to them.
 */
class ServerNicknameController extends ClientApiController
{
    public function update(Request $request, Server $server): JsonResponse
    {
        $name = trim((string) ($request->validate(['name' => 'nullable|string|max:191'])['name'] ?? ''));

        // An empty name, or one equal to the real name, removes the nickname.
        if ($name === '' || $name === $server->name) {
            ServerNickname::query()->where('user_id', $request->user()->id)->where('server_id', $server->id)->delete();

            return new JsonResponse(['nickname' => null]);
        }

        ServerNickname::query()->updateOrCreate(
            ['user_id' => $request->user()->id, 'server_id' => $server->id],
            ['name' => $name]
        );

        return new JsonResponse(['nickname' => $name]);
    }
}
