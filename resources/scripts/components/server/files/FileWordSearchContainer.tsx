import React, { useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import tw from 'twin.macro';
import styled from 'styled-components/macro';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolderOpen, faSearch } from '@fortawesome/free-solid-svg-icons';
import FileSearchDirectoryDialog from '@/components/server/files/FileSearchDirectoryDialog';
import ServerContentBlock from '@/components/elements/ServerContentBlock';
import FilesSubNavigation from '@/components/server/files/FilesSubNavigation';
import Input from '@/components/elements/Input';
import { Button } from '@/components/elements/button/index';
import { ServerContext } from '@/state/server';
import { useStoreState } from '@/state/hooks';
import { ServerError } from '@/components/elements/ScreenBlock';
import {
    FileSearchMatch,
    FileSearchMeta,
    FileSearchProgress,
    searchFileContentAll,
} from '@/api/server/files/searchFileContent';
import { encodePathSegments } from '@/helpers';
import useFlash from '@/plugins/useFlash';
import FlashMessageRender from '@/components/FlashMessageRender';

const ProgressTrack = styled.div`
    ${tw`w-full h-2 bg-neutral-900 rounded overflow-hidden`};
`;

const ProgressFill = styled.div`
    ${tw`h-full bg-cyan-400 transition-all duration-300 ease-out`};
`;

const formatMeta = (meta: FileSearchMeta): string => {
    const parts = [
        `przeskanowano ${meta.files_scanned} plików`,
        `${meta.matches} trafień`,
        `${meta.directories_scanned} katalogów`,
    ];

    if (meta.truncated) {
        parts.push('wyniki obcięte (limit)');
    }

    return parts.join(' · ');
};

const formatProgressLabel = (progress: FileSearchProgress): string => {
    const parts = [
        `${progress.files_scanned} / ${progress.files_limit} plików`,
        `${progress.directories_scanned} katalogów`,
    ];

    if (progress.directories_pending > 0) {
        parts.push(`${progress.directories_pending} w kolejce`);
    }

    if (progress.matches > 0) {
        parts.push(`${progress.matches} trafień`);
    }

    return parts.join(' · ');
};

export default () => {
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const abortRef = useRef(false);

    const [query, setQuery] = useState('');
    const [directory, setDirectory] = useState('/');
    const [directoryDialogOpen, setDirectoryDialogOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<FileSearchMatch[]>([]);
    const [meta, setMeta] = useState<FileSearchMeta | null>(null);
    const [progress, setProgress] = useState<FileSearchProgress | null>(null);
    const [searchedQuery, setSearchedQuery] = useState('');

    if (!rootAdmin) {
        return (
            <ServerError title={'Brak dostępu'} message={'Szukanie słowne jest dostępne tylko dla administratorów.'} />
        );
    }

    const handleSearch = async () => {
        const trimmed = query.trim();
        if (!trimmed) {
            return;
        }

        abortRef.current = false;
        setLoading(true);
        clearFlashes('file-search');
        setResults([]);
        setMeta(null);
        setProgress(null);

        try {
            const data = await searchFileContentAll(
                uuid,
                trimmed,
                directory.trim() || '/',
                (chunkProgress, partialResults) => {
                    if (abortRef.current) {
                        return;
                    }

                    setProgress(chunkProgress);
                    setResults(partialResults);
                }
            );

            if (abortRef.current) {
                return;
            }

            setResults(data.results);
            setMeta(data.meta);
            setProgress(data.progress);
            setSearchedQuery(data.query);
        } catch (error) {
            if (!abortRef.current) {
                clearAndAddHttpError({ key: 'file-search', error });
            }
        } finally {
            if (!abortRef.current) {
                setLoading(false);
            }
        }
    };

    const editUrl = (filePath: string) => `/server/${id}/files/edit#${encodePathSegments(filePath)}`;

    return (
        <ServerContentBlock title={'File Manager'} showFlashKey={'file-search'}>
            <FilesSubNavigation />
            <FlashMessageRender byKey={'file-search'} css={tw`mb-4`} />

            <div css={tw`bg-neutral-800 rounded p-4 mb-4`}>
                <p css={tw`text-sm text-neutral-400 mb-4`}>
                    Wyszukuje frazę w plikach tekstowych (yml, json, txt i podobne) do 0,5&nbsp;MB. Pomija katalogi{' '}
                    <code css={tw`text-neutral-300`}>world</code>, <code css={tw`text-neutral-300`}>cache</code> i{' '}
                    <code css={tw`text-neutral-300`}>logs</code> oraz symlinki.
                </p>

                <div css={tw`grid gap-4 md:grid-cols-2 mb-4`}>
                    <div>
                        <label htmlFor={'file_search_query'} css={tw`text-xs uppercase text-neutral-400 block mb-2`}>
                            Fraza
                        </label>
                        <Input
                            id={'file_search_query'}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !loading && handleSearch()}
                            placeholder={'np. pójść'}
                            disabled={loading}
                        />
                    </div>
                    <div>
                        <label
                            htmlFor={'file_search_directory'}
                            css={tw`text-xs uppercase text-neutral-400 block mb-2`}
                        >
                            Katalog startowy
                        </label>
                        <div css={tw`flex gap-2`}>
                            <Input
                                id={'file_search_directory'}
                                value={directory}
                                readOnly
                                css={tw`cursor-pointer`}
                                onClick={() => !loading && setDirectoryDialogOpen(true)}
                                placeholder={'/'}
                                disabled={loading}
                            />
                            <Button
                                type={'button'}
                                variant={Button.Variants.Secondary}
                                onClick={() => setDirectoryDialogOpen(true)}
                                disabled={loading}
                            >
                                <FontAwesomeIcon icon={faFolderOpen} css={tw`mr-2`} />
                                Wybierz
                            </Button>
                        </div>
                    </div>
                </div>

                <Button type={'button'} onClick={handleSearch} disabled={loading || !query.trim()}>
                    <FontAwesomeIcon icon={faSearch} css={tw`mr-2`} />
                    {loading ? 'Szukam...' : 'Szukaj'}
                </Button>
            </div>

            <FileSearchDirectoryDialog
                uuid={uuid}
                open={directoryDialogOpen}
                startPath={directory}
                onClose={() => setDirectoryDialogOpen(false)}
                onSelect={(path) => setDirectory(path)}
            />

            {loading && progress && (
                <div css={tw`bg-neutral-800 rounded p-4 mb-4`}>
                    <div css={tw`flex items-center justify-between gap-4 mb-2`}>
                        <p css={tw`text-sm text-neutral-300`}>
                            {progress.current_phase === 'listing_directories' && progress.files_scanned === 0
                                ? 'Indeksuję katalogi...'
                                : 'Przeszukuję pliki...'}
                        </p>
                        <p css={tw`text-sm text-cyan-400 font-medium`}>{progress.percent}%</p>
                    </div>
                    <ProgressTrack>
                        <ProgressFill style={{ width: `${progress.percent}%` }} />
                    </ProgressTrack>
                    <p css={tw`text-xs text-neutral-500 mt-2`}>{formatProgressLabel(progress)}</p>
                </div>
            )}

            {!loading && meta && (
                <div css={tw`mb-4`}>
                    <p css={tw`text-sm text-neutral-300`}>
                        Wyniki dla <strong css={tw`text-neutral-100`}>&quot;{searchedQuery}&quot;</strong>
                        {results.length === 0 ? ' — brak trafień.' : ` — ${formatMeta(meta)}.`}
                    </p>
                    {meta.files_skipped_extension > 0 || meta.files_skipped_size > 0 ? (
                        <p css={tw`text-xs text-neutral-500 mt-1`}>
                            Pominięto {meta.files_skipped_extension} plików (zły typ) i {meta.files_skipped_size} (za
                            duże).
                            {meta.directories_skipped > 0 && ` Wykluczono ${meta.directories_skipped} katalogów.`}
                        </p>
                    ) : null}
                </div>
            )}

            {(loading || results.length > 0) && results.length > 0 && (
                <div css={tw`overflow-x-auto`}>
                    <table css={tw`w-full text-sm text-left`}>
                        <thead>
                            <tr css={tw`text-neutral-400 border-b border-neutral-700`}>
                                <th css={tw`py-2 pr-4 font-normal`}>Plik</th>
                                <th css={tw`py-2 pr-4 font-normal w-16`}>Linia</th>
                                <th css={tw`py-2 font-normal`}>Treść</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((result, index) => (
                                <tr
                                    key={`${result.file}-${result.line}-${index}`}
                                    css={tw`border-b border-neutral-800 hover:bg-neutral-800`}
                                >
                                    <td css={tw`py-2 pr-4 align-top`}>
                                        <NavLink
                                            to={editUrl(result.file)}
                                            css={tw`text-cyan-400 hover:text-cyan-300 break-all`}
                                        >
                                            {result.file}
                                        </NavLink>
                                    </td>
                                    <td css={tw`py-2 pr-4 align-top text-neutral-400`}>{result.line}</td>
                                    <td css={tw`py-2 align-top text-neutral-300 break-all font-mono text-xs`}>
                                        {result.content}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </ServerContentBlock>
    );
};
