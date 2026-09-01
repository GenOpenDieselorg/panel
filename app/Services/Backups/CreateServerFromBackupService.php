<?php

namespace Pterodactyl\Services\Backups;

use Ramsey\Uuid\Uuid;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\User;
use Pterodactyl\Models\Backup;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Allocation;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Services\Nodes\NodeUsageService;
use Pterodactyl\Services\Servers\ServerCreationService;
use Pterodactyl\Repositories\Wings\DaemonBackupRepository;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

class CreateServerFromBackupService
{
    public const CACHE_PREFIX = 'backup_clone_';

    public function __construct(
        private ServerCreationService $serverCreationService,
        private DownloadLinkService $downloadLinkService,
        private DaemonBackupRepository $daemonRepository,
        private BackupClonePluginTemplateService $pluginTemplateService,
        private NodeUsageService $nodeUsageService,
    ) {
    }

    /**
     * Creates a new server using the source server's settings (with 300% CPU)
     * and the selected memory limit, then restores the given backup onto it.
     *
     * @throws \Throwable
     */
    public function handle(
        Server $source,
        Backup $backup,
        User $user,
        ?string $name = null,
        ?int $nodeId = null,
        ?string $pluginTemplate = null,
        ?int $memory = null,
        ?string $paperVersion = null,
        ?string $pluginMode = null,
        ?array $pluginSelection = null,
    ): Server
    {
        if ($backup->server_id !== $source->id) {
            throw new BadRequestHttpException('The requested backup does not belong to this server.');
        }

        if (!$backup->is_successful) {
            throw new BadRequestHttpException('This backup cannot be used to create a server: it has not completed successfully.');
        }

        if ($backup->disk !== Backup::ADAPTER_AWS_S3 && $backup->disk !== Backup::ADAPTER_WINGS) {
            throw new BadRequestHttpException('This backup uses an unsupported disk adapter and cannot be used.');
        }

        $source->load('variables');

        $environment = [];
        foreach ($source->variables as $variable) {
            $environment[$variable->env_variable] = $variable->server_value ?? $variable->default_value;
        }

        $cloneMemory = $this->cloneMemory($memory);
        $allocation = $this->findAllocation($source, $nodeId, $cloneMemory);

        $cloneStartup = $this->cloneStartup($cloneMemory);

        $newServer = $this->serverCreationService->handle([
            'name' => $name ?: $this->generateCloneServerName($source),
            'description' => $source->description,
            'owner_id' => $source->owner_id,
            'node_id' => $allocation->node_id,
            'allocation_id' => $allocation->id,
            'nest_id' => $source->nest_id,
            'egg_id' => $source->egg_id,
            'memory' => $cloneMemory,
            'swap' => $source->swap,
            'disk' => $source->disk,
            'io' => $source->io,
            'cpu' => 300,
            'threads' => $source->threads,
            'oom_disabled' => $source->oom_disabled,
            'database_limit' => $source->database_limit,
            'allocation_limit' => $source->allocation_limit,
            'backup_limit' => $source->backup_limit,
            'environment' => $environment,
            'startup' => $cloneStartup,
            'image' => $source->image,
            'skip_scripts' => true,
        ]);

        $downloadUrl = $this->downloadLinkService->handle($backup, $user);

        $tempBackup = $newServer->backups()->create([
            'name' => $backup->name,
            'uuid' => Uuid::uuid4()->toString(),
            'is_successful' => true,
            'is_locked' => false,
            'disk' => $backup->disk,
            'checksum' => $backup->checksum,
            'bytes' => $backup->bytes,
            'upload_id' => $backup->upload_id,
            'completed_at' => $backup->completed_at,
        ]);

        $newServer->update(['status' => Server::STATUS_RESTORING_BACKUP]);
        $this->daemonRepository->setServer($newServer)->restore($tempBackup, $downloadUrl, true);

        $template = $pluginTemplate !== null && trim($pluginTemplate) !== ''
            ? $this->pluginTemplateService->normalize($pluginTemplate)
            : $this->pluginTemplateService->get();

        Cache::put(self::CACHE_PREFIX . $newServer->id, [
            'temp_backup_id' => $tempBackup->id,
            'status' => 'restoring',
            'source_backup_uuid' => $backup->uuid,
            'plugin_template' => $template,
            'plugin_mode' => $pluginMode === 'keep' ? 'keep' : 'remove',
            'plugin_selection' => $this->sanitizePluginSelection($pluginSelection),
            'paper_version' => $paperVersion !== null && trim($paperVersion) !== '' ? trim($paperVersion) : null,
        ], now()->addHours(24));

        return $newServer;
    }

    /**
     * Keeps only safe jar file names from the plugin selection made while
     * creating the server.
     *
     * @return string[]
     */
    private function sanitizePluginSelection(?array $selection): array
    {
        return collect($selection ?? [])
            ->filter(fn ($name) => is_string($name)
                && $name !== ''
                && !str_contains($name, '/')
                && !str_contains($name, '\\')
                && !str_contains($name, '..')
                && str_ends_with(strtolower($name), '.jar'))
            ->unique()
            ->values()
            ->all();
    }

    public static function cacheKey(int $serverId): string
    {
        return self::CACHE_PREFIX . $serverId;
    }

    public static function getCloneState(int $serverId): ?array
    {
        return Cache::get(self::cacheKey($serverId));
    }

    public static function isAwaitingPluginSelection(int $serverId): bool
    {
        $state = self::getCloneState($serverId);

        return is_array($state) && ($state['status'] ?? null) === 'awaiting_plugins';
    }

    /**
     * @throws BadRequestHttpException
     */
    private function findAllocation(Server $source, ?int $nodeId, int $memory): Allocation
    {
        if ($nodeId !== null) {
            return $this->findAllocationOnNode($source, $nodeId, $memory);
        }

        $allocation = Allocation::query()
            ->where('node_id', $source->node_id)
            ->whereNull('server_id')
            ->first();

        if ($allocation && $this->nodeCanFitServer($source->node_id, $source, $memory)) {
            return $allocation;
        }

        $nodes = Node::query()
            ->where('public', true)
            ->where('maintenance_mode', false)
            ->with(['servers', 'allocations'])
            ->get()
            ->sortBy(fn ($node) => $this->nodeAllocatedMemory($node));

        foreach ($nodes as $node) {
            if (!$this->nodeCanFitServer($node->id, $source, $memory)) {
                continue;
            }

            $allocation = $node->allocations->firstWhere('server_id', null);
            if ($allocation) {
                return $allocation;
            }
        }

        throw new BadRequestHttpException('No available allocation with sufficient memory was found.');
    }

    /**
     * @throws BadRequestHttpException
     */
    private function findAllocationOnNode(Server $source, int $nodeId, int $memory): Allocation
    {
        /** @var Node|null $node */
        $node = Node::query()->find($nodeId);

        if (!$node) {
            throw new BadRequestHttpException('The selected node does not exist.');
        }

        if ($node->maintenance_mode) {
            throw new BadRequestHttpException('The selected node is currently under maintenance.');
        }

        if (!$this->nodeCanFitServer($node->id, $source, $memory)) {
            throw new BadRequestHttpException('The selected node does not have enough available memory or disk space.');
        }

        $allocation = Allocation::query()
            ->where('node_id', $nodeId)
            ->whereNull('server_id')
            ->first();

        if (!$allocation) {
            throw new BadRequestHttpException('No available allocation was found on the selected node.');
        }

        return $allocation;
    }

    private function nodeCanFitServer(int $nodeId, Server $source, int $memory): bool
    {
        $usage = $this->nodeUsageService->getForDeployment($memory, $source->disk);

        foreach ($usage['nodes'] as $node) {
            if ((int) $node['id'] === $nodeId) {
                return (bool) ($node['can_deploy'] ?? false);
            }
        }

        return false;
    }

    private function cloneMemory(?int $memory = null): int
    {
        return min(10240, max(2048, $memory ?? (int) config('backups.clone_memory', 3072)));
    }

    private function cloneStartup(int $memory): string
    {
        $memoryGiB = max(1, (int) round($memory / 1024));
        $startup = (string) config(
            'backups.clone_startup',
            'java -Xms3G -Xmx3G -Duser.timezone=Europe/Warsaw --add-modules=jdk.incubator.vector -XX:+UseZGC -XX:+AlwaysPreTouch -XX:+DisableExplicitGC -jar {{SERVER_JARFILE}} --nogui'
        );

        $startup = str_replace('{{CLONE_MEMORY_GB}}', (string) $memoryGiB, $startup);
        $startup = preg_replace('/-Xms\S+/', sprintf('-Xms%dG', $memoryGiB), $startup) ?? $startup;

        return preg_replace('/-Xmx\S+/', sprintf('-Xmx%dG', $memoryGiB), $startup) ?? $startup;
    }

    private function generateCloneServerName(Server $source): string
    {
        return sprintf('clone %s %s', $this->extractCloneMode($source->name), now()->format('d.m.Y'));
    }

    private function extractCloneMode(string $sourceName): string
    {
        $name = trim(preg_replace('/^clone:\s*/i', '', trim($sourceName)) ?? '');
        $name = trim(preg_replace('/\s+(prod(ukcja|iukcja)?|production)\s*$/iu', '', $name) ?? '');

        if ($name === '') {
            return 'server';
        }

        $parts = preg_split('/\s+/', $name) ?: [];

        return strtolower(count($parts) > 1 ? end($parts) : $parts[0]);
    }

    private function nodeAllocatedMemory(Node $node): int
    {
        return (int) $node->servers->sum('memory');
    }

}
