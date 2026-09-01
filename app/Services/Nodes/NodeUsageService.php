<?php

namespace Pterodactyl\Services\Nodes;

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Allocation;
use Illuminate\Cache\Repository;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\Utils;
use GuzzleHttp\Exception\TransferException;
use Carbon\Carbon;

class NodeUsageService
{
    private const CACHE_SECONDS = 15;

    public function __construct(private Repository $cache)
    {
    }

    /**
     * Returns live usage statistics for all nodes. Results are cached briefly
     * to avoid hammering Wings on every poll from the admin dashboard.
     */
    public function getAll(): array
    {
        return $this->cache->remember(
            'admin:node-usage:all',
            Carbon::now()->addSeconds(self::CACHE_SECONDS),
            fn () => $this->fetchAll()
        );
    }

    /**
     * Returns live usage for all public nodes enriched with deployment viability
     * for a server with the given memory and disk requirements.
     */
    public function getForDeployment(int $memory, int $disk): array
    {
        $data = $this->getAll();

        $freeAllocations = Allocation::query()
            ->selectRaw('node_id, COUNT(*) as count')
            ->whereNull('server_id')
            ->groupBy('node_id')
            ->pluck('count', 'node_id');

        foreach ($data['nodes'] as &$node) {
            $freeCount = (int) ($freeAllocations[$node['id']] ?? 0);
            $diskMax = (int) $node['allocated']['disk_max_mib'];
            $systemMemoryMib = (int) floor(((int) $node['system']['memory_bytes']) / 1024 / 1024);
            $liveMemoryMib = (int) ceil(((int) $node['live']['memory_bytes']) / 1024 / 1024);
            $memAvail = $systemMemoryMib - $liveMemoryMib;
            $diskAvail = $diskMax - (int) $node['allocated']['disk_mib'];

            $node['free_allocations'] = $freeCount;
            $node['available_memory_mib'] = max(0, $memAvail);
            $node['available_disk_mib'] = max(0, $diskAvail);
            $node['can_deploy'] = $node['online']
                && !$node['maintenance_mode']
                && $freeCount > 0
                && $memAvail >= $memory
                && $diskAvail >= $disk;
        }
        unset($node);

        usort($data['nodes'], function (array $a, array $b) {
            if ($a['can_deploy'] !== $b['can_deploy']) {
                return $b['can_deploy'] <=> $a['can_deploy'];
            }

            return ($a['live']['memory_percent'] ?? 0) <=> ($b['live']['memory_percent'] ?? 0);
        });

        return $data;
    }

    private function fetchAll(): array
    {
        $nodes = Node::query()->with('location')->withCount('servers')->get();

        $allocated = DB::table('servers')
            ->selectRaw('node_id, IFNULL(SUM(memory), 0) as memory, IFNULL(SUM(disk), 0) as disk')
            ->groupBy('node_id')
            ->get()
            ->keyBy('node_id');

        $promises = [];
        foreach ($nodes as $node) {
            $client = new Client([
                'verify' => app()->environment('production'),
                'base_uri' => $node->getConnectionAddress(),
                'timeout' => config('pterodactyl.guzzle.timeout'),
                'connect_timeout' => config('pterodactyl.guzzle.connect_timeout'),
                'headers' => [
                    'Authorization' => 'Bearer ' . $node->getDecryptedKey(),
                    'Accept' => 'application/json',
                ],
            ]);

            $promises[$node->id] = [
                'node' => $node,
                'system' => $client->getAsync('/api/system?v=2'),
                'servers' => $client->getAsync('/api/servers'),
            ];
        }

        $results = [];
        foreach ($promises as $nodeId => $requests) {
            /** @var Node $node */
            $node = $requests['node'];
            $alloc = $allocated->get($nodeId);

            try {
                $responses = Utils::unwrap([
                    'system' => $requests['system'],
                    'servers' => $requests['servers'],
                ]);

                $system = json_decode($responses['system']->getBody()->__toString(), true) ?? [];
                $servers = json_decode($responses['servers']->getBody()->__toString(), true) ?? [];
            } catch (TransferException) {
                $results[] = $this->buildNodeResult($node, $alloc, null, null, false);

                continue;
            }

            $results[] = $this->buildNodeResult($node, $alloc, $system, $servers, true);
        }

        return [
            'cached_seconds' => self::CACHE_SECONDS,
            'updated_at' => Carbon::now()->toIso8601String(),
            'nodes' => $results,
        ];
    }

    private function buildNodeResult(Node $node, $alloc, ?array $system, ?array $servers, bool $online): array
    {
        $allocatedMemory = (int) ($alloc->memory ?? 0);
        $allocatedDisk = (int) ($alloc->disk ?? 0);

        $memoryLimit = $this->maxWithOverallocation($node->memory, $node->memory_overallocate);
        $diskLimit = $this->maxWithOverallocation($node->disk, $node->disk_overallocate);

        $liveMemory = 0;
        $liveDisk = 0;
        $liveCpu = 0.0;
        $runningServers = 0;

        if (is_array($servers)) {
            foreach ($servers as $server) {
                $utilization = Arr::get($server, 'utilization', []);
                $state = Arr::get($server, 'state', 'offline');

                $liveDisk += (int) Arr::get($utilization, 'disk_bytes', 0);

                if ($state === 'running') {
                    ++$runningServers;
                    $liveMemory += (int) Arr::get($utilization, 'memory_bytes', 0);
                    $liveCpu += (float) Arr::get($utilization, 'cpu_absolute', 0);
                }
            }
        }

        $systemMemoryBytes = (int) Arr::get($system, 'system.memory_bytes', 0);
        $cpuThreads = (int) Arr::get($system, 'system.cpu_threads', 0);

        // Real disk size of the machine as reported by df over SSH (p:node:sync-real-disk),
        // falling back to the configured limit when it has not been collected yet.
        $realDiskBytes = (int) ($node->real_disk_bytes ?? 0);
        $diskCapacityBytes = $realDiskBytes > 0 ? $realDiskBytes : $diskLimit * 1024 * 1024;

        return [
            'id' => $node->id,
            'name' => $node->name,
            'location' => $node->location->short ?? '',
            'maintenance_mode' => (bool) $node->maintenance_mode,
            'online' => $online,
            'servers_count' => $node->servers_count,
            'wings_version' => Arr::get($system, 'version'),
            'system' => [
                'os' => Arr::get($system, 'system.os'),
                'memory_bytes' => $systemMemoryBytes,
                'cpu_threads' => $cpuThreads,
                'disk_total_bytes' => $realDiskBytes > 0 ? $realDiskBytes : null,
                'containers_running' => (int) Arr::get($system, 'docker.containers.running', 0),
                'containers_total' => (int) Arr::get($system, 'docker.containers.total', 0),
            ],
            'live' => [
                'memory_bytes' => $liveMemory,
                'memory_percent' => $systemMemoryBytes > 0 ? ($liveMemory / $systemMemoryBytes) * 100 : 0,
                'disk_bytes' => $liveDisk,
                'disk_percent' => $diskCapacityBytes > 0 ? ($liveDisk / $diskCapacityBytes) * 100 : 0,
                'cpu_absolute' => round($liveCpu, 2),
                // Share of the machine's total CPU capacity (cpu_absolute is 100% per thread).
                'cpu_percent' => $cpuThreads > 0 ? round(min(100, $liveCpu / $cpuThreads), 2) : min(100, $liveCpu),
                'running_servers' => $runningServers,
            ],
            'allocated' => [
                'memory_mib' => $allocatedMemory,
                'memory_percent' => $memoryLimit > 0 ? ($allocatedMemory / $memoryLimit) * 100 : 0,
                'memory_max_mib' => $memoryLimit,
                'disk_mib' => $allocatedDisk,
                'disk_percent' => $diskLimit > 0 ? ($allocatedDisk / $diskLimit) * 100 : 0,
                'disk_max_mib' => $diskLimit,
            ],
        ];
    }

    private function maxWithOverallocation(int $value, int $overallocate): int
    {
        if ($overallocate > 0) {
            return (int) ($value * (1 + ($overallocate / 100)));
        }

        return $value;
    }
}
