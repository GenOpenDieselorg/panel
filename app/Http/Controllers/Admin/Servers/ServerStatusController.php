<?php

namespace Pterodactyl\Http\Controllers\Admin\Servers;

use GuzzleHttp\Client;
use Illuminate\Http\Request;
use GuzzleHttp\Promise\Utils;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Server;
use Pterodactyl\Http\Controllers\Controller;

class ServerStatusController extends Controller
{
    /**
     * Returns the current power state of the given servers, keyed by server uuid. Wings
     * exposes every server on a node through a single call, so the admin list only ever
     * makes one request per node no matter how many servers are shown.
     */
    public function index(Request $request): JsonResponse
    {
        $uuids = array_filter((array) $request->query('uuids', []), 'is_string');
        if (empty($uuids)) {
            return new JsonResponse(['data' => (object) []]);
        }

        $servers = Server::query()
            ->whereIn('uuid', array_slice($uuids, 0, 500))
            ->get(['uuid', 'node_id']);

        $nodes = Node::query()->whereIn('id', $servers->pluck('node_id')->unique())->get();

        $promises = [];
        foreach ($nodes as $node) {
            $promises[$node->id] = $this->client($node)->getAsync('/api/servers');
        }

        $states = [];
        foreach (Utils::settle($promises)->wait() as $nodeId => $result) {
            if ($result['state'] !== 'fulfilled') {
                continue;
            }

            $body = json_decode($result['value']->getBody()->__toString(), true);
            foreach (is_array($body) ? $body : [] as $entry) {
                $uuid = $entry['configuration']['uuid'] ?? null;
                if (!is_string($uuid)) {
                    continue;
                }

                $states[$uuid] = [
                    'state' => is_string($entry['state'] ?? null) ? $entry['state'] : 'unknown',
                    'suspended' => (bool) ($entry['is_suspended'] ?? false),
                ];
            }

            unset($nodeId);
        }

        $data = [];
        foreach ($servers as $server) {
            // Nodes that failed to answer leave their servers without a known state.
            $data[$server->uuid] = $states[$server->uuid] ?? ['state' => 'unknown', 'suspended' => false];
        }

        return new JsonResponse(['data' => (object) $data]);
    }

    /**
     * A short-lived client for a node — an unreachable node should not hold the whole
     * status request open.
     */
    private function client(Node $node): Client
    {
        return new Client([
            'verify' => app()->environment('production'),
            'base_uri' => $node->getConnectionAddress(),
            'timeout' => 8,
            'connect_timeout' => 3,
            'headers' => [
                'Authorization' => 'Bearer ' . $node->getDecryptedKey(),
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ],
        ]);
    }
}
