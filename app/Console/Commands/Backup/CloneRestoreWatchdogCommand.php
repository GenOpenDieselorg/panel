<?php

namespace Pterodactyl\Console\Commands\Backup;

use Carbon\Carbon;
use Throwable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Models\Backup;
use Pterodactyl\Models\Server;
use Pterodactyl\Repositories\Wings\DaemonServerRepository;
use Pterodactyl\Services\Backups\CreateServerFromBackupService;

class CloneRestoreWatchdogCommand extends Command
{
    protected $signature = 'p:backup:clone-watchdog
                            {--stall-minutes=30 : Fail a clone after this many minutes without a single new byte}
                            {--dry-run : Report what would happen without changing anything}';

    protected $description = 'Fails clones whose backup restore has stopped making progress and releases the server.';

    public function __construct(private DaemonServerRepository $daemonRepository)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $stallMinutes = max(5, (int) $this->option('stall-minutes'));
        $dryRun = (bool) $this->option('dry-run');
        $ids = CreateServerFromBackupService::activeClones();

        if (empty($ids)) {
            $this->info('No clone restores are currently being tracked.');

            return self::SUCCESS;
        }

        foreach ($ids as $serverId) {
            $state = CreateServerFromBackupService::getCloneState($serverId);

            // The cache entry is gone (expired or cleaned up), so there is nothing
            // left to watch for this server.
            if (!is_array($state)) {
                CreateServerFromBackupService::untrackClone($serverId);

                continue;
            }

            // Once the restore finishes the flow moves on to plugin selection, which
            // waits on the user rather than on Wings.
            if (($state['status'] ?? null) !== 'restoring') {
                continue;
            }

            /** @var Server|null $server */
            $server = Server::query()->find($serverId);
            if (is_null($server)) {
                CreateServerFromBackupService::untrackClone($serverId);

                continue;
            }

            $this->inspect($server, $state, $stallMinutes, $dryRun);
        }

        return self::SUCCESS;
    }

    private function inspect(Server $server, array $state, int $stallMinutes, bool $dryRun): void
    {
        $previous = (int) ($state['progress_bytes'] ?? 0);
        $since = Carbon::createFromTimestamp((int) ($state['progress_at'] ?? now()->getTimestamp()));
        $current = $this->currentBytes($server);

        // Wings could not be reached. Deliberately leave the stall timer running so
        // that a node which never comes back still releases the server eventually.
        if (is_null($current)) {
            $this->warn(sprintf('#%d %s: node unreachable, stalled since %s.', $server->id, $server->name, $since->diffForHumans()));
        } elseif ($current > $previous) {
            if (!$dryRun) {
                CreateServerFromBackupService::recordProgress($server->id, $current);
            }

            $this->info(sprintf(
                '#%d %s: %s restored%s, still moving (+%s since %s).',
                $server->id,
                $server->name,
                $this->humanBytes($current),
                $this->percentage($current, $state),
                $this->humanBytes($current - $previous),
                $since->diffForHumans()
            ));

            return;
        }

        if ($since->gt(now()->subMinutes($stallMinutes))) {
            $this->line(sprintf(
                '#%d %s: no progress since %s, below the %d minute threshold.',
                $server->id,
                $server->name,
                $since->diffForHumans(),
                $stallMinutes
            ));

            return;
        }

        $this->error(sprintf(
            '#%d %s: no progress for over %d minutes, failing the clone.',
            $server->id,
            $server->name,
            $stallMinutes
        ));

        if (!$dryRun) {
            $this->failClone($server, $state, $stallMinutes);
        }
    }

    /**
     * Marks the clone as failed and puts the server back into a state where the
     * user can delete it or try again.
     */
    private function failClone(Server $server, array $state, int $stallMinutes): void
    {
        try {
            Activity::event('server:backup.restore-failed')
                ->subject($server)
                ->property('reason', sprintf('Restore made no progress for %d minutes.', $stallMinutes))
                ->property('restored_bytes', (int) ($state['progress_bytes'] ?? 0))
                ->log();
        } catch (Throwable $exception) {
            $this->warn('  could not write the activity log entry: ' . $exception->getMessage());
        }

        $server->update(['status' => null]);

        if (!empty($state['temp_backup_id'])) {
            Backup::query()->where('id', $state['temp_backup_id'])->delete();
        }

        // Wings flags a server as suspended for the duration of a restore and only
        // clears it when the restore returns. A hung restore never returns, so push
        // the Panel's configuration back down to release it.
        try {
            $this->daemonRepository->setServer($server)->sync();
        } catch (Throwable $exception) {
            $this->warn('  could not resync the server with Wings: ' . $exception->getMessage());
        }

        Cache::forget(CreateServerFromBackupService::cacheKey($server->id));
        CreateServerFromBackupService::untrackClone($server->id);
    }

    private function currentBytes(Server $server): ?int
    {
        try {
            $details = $this->daemonRepository->setServer($server)->getDetails();
        } catch (Throwable) {
            return null;
        }

        return (int) data_get($details, 'utilization.disk_bytes', 0);
    }

    private function percentage(int $current, array $state): string
    {
        $expected = (int) ($state['expected_bytes'] ?? 0);

        return $expected > 0 ? sprintf(' (%.1f%%)', min(100, $current / $expected * 100)) : '';
    }

    private function humanBytes(int $bytes): string
    {
        return $bytes >= 1073741824
            ? sprintf('%.2f GiB', $bytes / 1073741824)
            : sprintf('%.1f MiB', $bytes / 1048576);
    }
}
