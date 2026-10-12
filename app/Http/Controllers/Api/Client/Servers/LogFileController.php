<?php

namespace Pterodactyl\Http\Controllers\Api\Client\Servers;

use Illuminate\Http\Response;
use Pterodactyl\Models\Server;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;
use Pterodactyl\Http\Controllers\Api\Client\ClientApiController;
use Pterodactyl\Exceptions\Http\Server\FileSizeTooLargeException;
use Pterodactyl\Http\Requests\Api\Client\Servers\Files\GetLogFileRequest;

/**
 * Serves log files to the log viewer. Unlike the editor endpoint this allows logs up to 10 MB and
 * unpacks rotated .log.gz files, which the editor cannot open at all.
 */
class LogFileController extends ClientApiController
{
    public const MAX_FILE_BYTES = 10 * 1024 * 1024;

    /**
     * Cap on the unpacked size of a .log.gz, so a small but highly compressed file cannot
     * exhaust memory.
     */
    public const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

    public function __construct(private DaemonFileRepository $fileRepository)
    {
        parent::__construct();
    }

    /**
     * @throws DisplayException
     * @throws \Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function __invoke(GetLogFileRequest $request, Server $server): Response
    {
        $file = $request->input('file');

        try {
            $contents = $this->fileRepository->setServer($server)->getContent($file, self::MAX_FILE_BYTES);
        } catch (FileSizeTooLargeException) {
            throw new DisplayException('This log is larger than 10 MB. Download it instead.');
        }

        if (strlen($contents) > self::MAX_FILE_BYTES) {
            throw new DisplayException('This log is larger than 10 MB. Download it instead.');
        }

        if (str_ends_with(strtolower($file), '.gz')) {
            $unpacked = @gzdecode($contents, self::MAX_UNPACKED_BYTES);

            if ($unpacked === false) {
                throw new DisplayException('Could not unpack this file. It is either corrupt or larger than 64 MB once unpacked.');
            }

            $contents = $unpacked;
        }

        Activity::event('server:file.read')->property('file', $file)->log();

        return new Response($contents, Response::HTTP_OK, ['Content-Type' => 'text/plain; charset=utf-8']);
    }
}
