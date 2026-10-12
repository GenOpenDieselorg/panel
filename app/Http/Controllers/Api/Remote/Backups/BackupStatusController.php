<?php

namespace Pterodactyl\Http\Controllers\Api\Remote\Backups;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Pterodactyl\Models\Backup;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Models\Server;
use Pterodactyl\Services\Servers\PaperMcService;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Extensions\Backups\BackupManager;
use Pterodactyl\Extensions\Filesystem\S3Filesystem;
use Pterodactyl\Exceptions\Http\HttpForbiddenException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Pterodactyl\Http\Requests\Api\Remote\ReportBackupCompleteRequest;
use Pterodactyl\Services\Backups\CreateServerFromBackupService;
use Illuminate\Support\Facades\Cache;
use Throwable;

class BackupStatusController extends Controller
{
    /**
     * BackupStatusController constructor.
     */
    public function __construct(
        private BackupManager $backupManager,
        private PaperMcService $paperMcService,
        private DaemonFileRepository $fileRepository,
    ) {
    }

    /**
     * Handles updating the state of a backup.
     *
     * @throws \Throwable
     */
    public function index(ReportBackupCompleteRequest $request, string $backup): JsonResponse
    {
        // Get the node associated with the request.
        /** @var \Pterodactyl\Models\Node $node */
        $node = $request->attributes->get('node');

        /** @var Backup $model */
        $model = Backup::query()
            ->where('uuid', $backup)
            ->firstOrFail();

        // Check that the backup is "owned" by the node making the request. This avoids other nodes
        // from messing with backups that they don't own.
        /** @var \Pterodactyl\Models\Server $server */
        $server = $model->server;
        if ($server->node_id !== $node->id) {
            throw new HttpForbiddenException('Requesting node does not have permission to access this server.');
        }

        if ($model->is_successful) {
            throw new BadRequestHttpException('Cannot update the status of a backup that is already marked as completed.');
        }

        $action = $request->boolean('successful') ? 'server:backup.complete' : 'server:backup.fail';
        $log = Activity::event($action)->subject($model, $model->server)->property('name', $model->name);

        $log->transaction(function () use ($model, $request) {
            $successful = $request->boolean('successful');

            $model->fill([
                'is_successful' => $successful,
                // Change the lock state to unlocked if this was a failed backup so that it can be
                // deleted easily. Also does not make sense to have a locked backup on the system
                // that is failed.
                'is_locked' => $successful ? $model->is_locked : false,
                'checksum' => $successful ? ($request->input('checksum_type') . ':' . $request->input('checksum')) : null,
                'bytes' => $successful ? $request->input('size') : 0,
                'completed_at' => CarbonImmutable::now(),
            ])->save();

            // Check if we are using the s3 backup adapter. If so, make sure we mark the backup as
            // being completed in S3 correctly.
            $adapter = $this->backupManager->adapter();
            if ($adapter instanceof S3Filesystem) {
                $this->completeMultipartUpload($model, $adapter, $successful, $request->input('parts'));
            }
        });

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    /**
     * Handles toggling the restoration status of a server. The server status field should be
     * set back to null, even if the restoration failed. This is not an unsolvable state for
     * the server, and the user can keep trying to restore, or just use the reinstall button.
     *
     * The only thing the successful field does is update the entry value for the audit logs
     * table tracking for this restoration.
     *
     * @throws \Throwable
     */
    public function restore(Request $request, string $backup): JsonResponse
    {
        /** @var Backup $model */
        $model = Backup::query()->where('uuid', $backup)->firstOrFail();

        $node = $request->attributes->get('node');
        if (! $model->server->node->is($node)) {
            throw new HttpForbiddenException('Requesting node does not have permission to access this server.');
        }

        $model->server->update(['status' => null]);

        $cacheKey = CreateServerFromBackupService::cacheKey($model->server->id);
        if ($request->boolean('successful') && Cache::has($cacheKey)) {
            $state = Cache::get($cacheKey);
            $paperVersion = is_array($state) ? ($state['paper_version'] ?? null) : null;

            if (is_string($paperVersion) && $paperVersion !== '') {
                $state['paper_download'] = $this->downloadSelectedPaper($model->server, $paperVersion);
            }

            $state['status'] = 'awaiting_plugins';
            Cache::put($cacheKey, $state, now()->addHours(24));
        } elseif (!$request->boolean('successful') && Cache::has($cacheKey)) {
            Cache::forget($cacheKey);
            CreateServerFromBackupService::untrackClone($model->server->id);
        }

        Activity::event($request->boolean('successful') ? 'server:backup.restore-complete' : 'server.backup.restore-failed')
            ->subject($model, $model->server)
            ->property('name', $model->name)
            ->log();

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    private function downloadSelectedPaper(Server $server, string $version): array
    {
        try {
            $jarVariable = $server->variables()->where('env_variable', 'SERVER_JARFILE')->first();

            if (is_null($jarVariable)) {
                throw new BadRequestHttpException('This server does not have a SERVER_JARFILE startup variable.');
            }

            $targetFile = $jarVariable->server_value ?? $jarVariable->default_value;
            if (!is_string($targetFile) || $targetFile === '' || !$this->paperMcService->isSafeFileName($targetFile)) {
                throw new BadRequestHttpException('The configured server jar file name is invalid.');
            }

            $build = $this->paperMcService->getLatestBuildDownload($version);
            $tempPath = $this->paperMcService->downloadToTemporaryFile($build['download_url']);

            try {
                $this->fileRepository->setServer($server)->writeFile(
                    '/' . ltrim($targetFile, '/'),
                    $tempPath
                );
            } finally {
                @unlink($tempPath);
            }

            Activity::event('server:startup.paper-download')
                ->subject($server)
                ->property('version', $build['version'])
                ->property('build', $build['build'])
                ->property('filename', $targetFile)
                ->log();

            return [
                'status' => 'success',
                'version' => $build['version'],
                'build' => $build['build'],
                'filename' => $targetFile,
            ];
        } catch (Throwable $exception) {
            Activity::event('server:startup.paper-download-failed')
                ->subject($server)
                ->property('version', $version)
                ->property('error', $exception->getMessage())
                ->log();

            return [
                'status' => 'failed',
                'version' => $version,
                'error' => $exception->getMessage(),
            ];
        }
    }

    /**
     * Marks a multipart upload in a given S3-compatible instance as failed or successful for
     * the given backup.
     *
     * @throws \Exception
     * @throws DisplayException
     */
    protected function completeMultipartUpload(Backup $backup, S3Filesystem $adapter, bool $successful, ?array $parts): void
    {
        // This should never really happen, but if it does don't let us fall victim to Amazon's
        // wildly fun error messaging. Just stop the process right here.
        if (empty($backup->upload_id)) {
            // A failed backup doesn't need to error here, this can happen if the backup encounters
            // an error before we even start the upload. AWS gives you tooling to clear these failed
            // multipart uploads as needed too.
            if (!$successful) {
                return;
            }

            throw new DisplayException('Cannot complete backup request: no upload_id present on model.');
        }

        $params = [
            'Bucket' => $adapter->getBucket(),
            'Key' => sprintf('%s/%s.tar.gz', $backup->server->uuid, $backup->uuid),
            'UploadId' => $backup->upload_id,
        ];

        $client = $adapter->getClient();
        if (!$successful) {
            $client->execute($client->getCommand('AbortMultipartUpload', $params));

            return;
        }

        // Otherwise send a CompleteMultipartUpload request.
        $params['MultipartUpload'] = [
            'Parts' => [],
        ];

        if (is_null($parts)) {
            $params['MultipartUpload']['Parts'] = $client->execute($client->getCommand('ListParts', $params))['Parts'];
        } else {
            foreach ($parts as $part) {
                $params['MultipartUpload']['Parts'][] = [
                    'ETag' => $part['etag'],
                    'PartNumber' => $part['part_number'],
                ];
            }
        }

        $client->execute($client->getCommand('CompleteMultipartUpload', $params));
    }
}
