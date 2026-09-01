<?php

namespace Pterodactyl\Console\Commands\Node;

use Carbon\Carbon;
use Illuminate\Console\Command;
use Pterodactyl\Models\Node;
use Symfony\Component\Process\Process;

class SyncNodeRealDiskCommand extends Command
{
    protected $signature = 'p:node:sync-real-disk
                            {--node= : Only sync the node with this id}';

    protected $description = 'Reads the real disk size of each node machine over SSH (df on the daemon data directory).';

    public function handle(): int
    {
        $query = Node::query();

        if ($nodeId = $this->option('node')) {
            $query->where('id', $nodeId);
        }

        $user = config('pterodactyl.node_monitor.ssh_user', 'root');
        $timeout = (int) config('pterodactyl.node_monitor.ssh_timeout', 10);
        $failures = 0;

        foreach ($query->get() as $node) {
            $path = $node->daemonBase ?: '/var/lib/pterodactyl/volumes';

            $process = new Process([
                'ssh',
                '-o', 'BatchMode=yes',
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=' . max(1, min($timeout, 30)),
                sprintf('%s@%s', $user, $node->fqdn),
                'df', '-B1', '--output=size', '--', $path,
            ], null, null, null, $timeout + 5);

            try {
                $process->run();
            } catch (\Throwable $exception) {
                $this->error(sprintf('%s: %s', $node->name, $exception->getMessage()));
                ++$failures;

                continue;
            }

            if (!$process->isSuccessful()) {
                $this->error(sprintf('%s: ssh/df failed: %s', $node->name, trim($process->getErrorOutput()) ?: 'unknown error'));
                ++$failures;

                continue;
            }

            $lines = array_values(array_filter(explode("\n", trim($process->getOutput()))));
            $sizeBytes = (int) trim(end($lines) ?: '0');

            if ($sizeBytes <= 0) {
                $this->error(sprintf('%s: could not parse df output.', $node->name));
                ++$failures;

                continue;
            }

            $node->forceFill([
                'real_disk_bytes' => $sizeBytes,
                'real_disk_checked_at' => Carbon::now(),
            ])->saveQuietly();

            $this->info(sprintf('%s: %s GiB (%s)', $node->name, number_format($sizeBytes / 1073741824, 1), $path));
        }

        return $failures > 0 ? self::FAILURE : self::SUCCESS;
    }
}
