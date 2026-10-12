import React, { useEffect, useState } from 'react';
import { httpErrorToHuman } from '@/api/http';
import { CSSTransition } from 'react-transition-group';
import Spinner from '@/components/elements/Spinner';
import FileObjectRow from '@/components/server/files/FileObjectRow';
import FileManagerBreadcrumbs from '@/components/server/files/FileManagerBreadcrumbs';
import { FileObject } from '@/api/server/files/loadDirectory';
import NewDirectoryButton from '@/components/server/files/NewDirectoryButton';
import { NavLink, useLocation } from 'react-router-dom';
import Can from '@/components/elements/Can';
import { ServerError } from '@/components/elements/ScreenBlock';
import tw from 'twin.macro';
import Button from '@/components/elements/Button';
import { ServerContext } from '@/state/server';
import useFileManagerSwr from '@/plugins/useFileManagerSwr';
import FileManagerStatus from '@/components/server/files/FileManagerStatus';
import FilesSubNavigation from '@/components/server/files/FilesSubNavigation';
import MassActionsBar from '@/components/server/files/MassActionsBar';
import UploadButton from '@/components/server/files/UploadButton';
import ServerContentBlock from '@/components/elements/ServerContentBlock';
import { useStoreActions } from '@/state/hooks';
import ErrorBoundary from '@/components/elements/ErrorBoundary';
import { FileActionCheckbox } from '@/components/server/files/SelectFileCheckbox';
import { hashToPath, cleanDirectoryPath } from '@/helpers';
import style from './style.module.css';
import { Alert } from '@/components/elements/alert';
import { findPluginVersionConflicts } from '@/lib/pluginVersionConflicts';
import PluginConflictScrollMarkers from '@/components/server/files/PluginConflictScrollMarkers';
import Select from '@/components/elements/Select';
import useSWR from 'swr';
import { getPluginUpdates } from '@/api/server/plugins/pluginUpdates';
import { PluginUpdatesContext } from '@/components/server/files/plugins/PluginUpdatesContext';
import PluginUpdatesBar from '@/components/server/files/plugins/PluginUpdatesBar';
import PluginUpdateModal from '@/components/server/files/plugins/PluginUpdateModal';

const FILE_DISPLAY_LIMIT = 400;

type SortMode = 'name_asc' | 'name_desc' | 'modified_desc' | 'size_desc';

const SORT_MODES: SortMode[] = ['name_asc', 'name_desc', 'modified_desc', 'size_desc'];

const isSortMode = (value: unknown): value is SortMode => SORT_MODES.includes(value as SortMode);

const SORT_STORAGE_KEY = 'pterodactyl:files:sort';
const DEFAULT_SORT_MODE: SortMode = 'name_asc';

const isPluginsDirectory = (directory: string): boolean => cleanDirectoryPath(directory) === '/plugins';

const isLogsDirectory = (directory: string): boolean => {
    const path = cleanDirectoryPath(directory);

    // Matches /logs as well as nested log directories such as /plugins/Foo/logs.
    return /(^|\/)logs(\/|$)/.test(path);
};

// Places directories before files while keeping the ordering produced by the active sort mode.
const directoriesFirst = (a: FileObject, b: FileObject): number => (a.isFile === b.isFile ? 0 : a.isFile ? 1 : -1);

// `localeCompare` constructs a collator on every single call, which is the most expensive part of
// ordering a large directory. Building it once and reusing `compare` avoids that entirely.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// The logs view orders by creation time, which is deliberately not offered as a manual sort mode.
type EffectiveSortMode = SortMode | 'created_desc';

interface DecoratedFile {
    file: FileObject;
    // Sort key for the date and size modes. The name modes compare names directly.
    value: number;
}

// An unparseable date yields NaN, which makes a comparator inconsistent and leaves the sort order
// undefined. Collapsing it to 0 keeps such entries together at the bottom instead.
const timestamp = (date: Date): number => {
    const value = date.getTime();

    return Number.isNaN(value) ? 0 : value;
};

const sortFiles = (files: FileObject[], directory: string, sortMode: SortMode): FileObject[] => {
    // The logs directory is always presented newest-first, by creation time, regardless of the
    // sort mode the user selected.
    const effectiveSortMode: EffectiveSortMode = isLogsDirectory(directory) ? 'created_desc' : sortMode;

    // Deduplicate by name in a single pass. The previous adjacent-pair check only caught duplicates
    // while the list happened to be name-ordered, so it silently did nothing in the date modes.
    const seen = new Set<string>();
    const decorated: DecoratedFile[] = [];

    for (const file of files) {
        if (seen.has(file.name)) continue;
        seen.add(file.name);

        // Each sort key is computed exactly once here. Reading it inside the comparator instead
        // would call getTime() O(n log n) times over the course of the sort.
        let value = 0;
        if (effectiveSortMode === 'created_desc') {
            value = timestamp(file.createdAt);
        } else if (effectiveSortMode === 'modified_desc') {
            value = timestamp(file.modifiedAt);
        } else if (effectiveSortMode === 'size_desc') {
            value = file.size;
        }

        decorated.push({ file, value });
    }

    switch (effectiveSortMode) {
        case 'created_desc':
        case 'modified_desc':
            // Newest first. Directories stay interleaved so the ordering remains purely temporal.
            decorated.sort((a, b) => b.value - a.value);
            break;
        case 'size_desc':
            decorated.sort((a, b) => directoriesFirst(a.file, b.file) || b.value - a.value);
            break;
        case 'name_desc':
            decorated.sort((a, b) => directoriesFirst(a.file, b.file) || collator.compare(b.file.name, a.file.name));
            break;
        case 'name_asc':
        default:
            decorated.sort((a, b) => directoriesFirst(a.file, b.file) || collator.compare(a.file.name, b.file.name));
            break;
    }

    // Trim only after sorting. Slicing first would hand back whatever order the daemon happened to
    // return, so a /logs directory over the limit would drop the newest files before ranking them.
    const limited = decorated.length > FILE_DISPLAY_LIMIT ? decorated.slice(0, FILE_DISPLAY_LIMIT) : decorated;

    return limited.map((entry) => entry.file);
};

export default () => {
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const { hash } = useLocation();
    const { data: files, error, mutate } = useFileManagerSwr();
    const directory = ServerContext.useStoreState((state) => state.files.directory);
    const clearFlashes = useStoreActions((actions) => actions.flashes.clearFlashes);
    const setDirectory = ServerContext.useStoreActions((actions) => actions.files.setDirectory);

    const setSelectedFiles = ServerContext.useStoreActions((actions) => actions.files.setSelectedFiles);
    const selectedFilesLength = ServerContext.useStoreState((state) => state.files.selectedFiles.length);

    const [sortMode, setSortMode] = useState<SortMode>(() => {
        const stored = localStorage.getItem(SORT_STORAGE_KEY);

        return isSortMode(stored) ? stored : DEFAULT_SORT_MODE;
    });

    const onSortModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.currentTarget.value as SortMode;

        setSortMode(value);
        localStorage.setItem(SORT_STORAGE_KEY, value);
    };

    useEffect(() => {
        clearFlashes('files');
        setSelectedFiles([]);
        setDirectory(hashToPath(hash));
    }, [hash]);

    useEffect(() => {
        mutate();
    }, [directory]);

    const onSelectAllClick = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedFiles(e.currentTarget.checked ? files?.map((file) => file.name) || [] : []);
    };

    const inPluginsDirectory = isPluginsDirectory(directory);
    const [pluginModalFile, setPluginModalFile] = useState<string | null>(null);
    const [pluginCheckRunning, setPluginCheckRunning] = useState(false);
    const { data: pluginUpdates, mutate: mutatePluginUpdates } = useSWR(
        inPluginsDirectory ? `${uuid}:plugin-updates` : null,
        () => getPluginUpdates(uuid),
        // Poll while an on-demand check is running so the results show up as soon as it ends.
        { refreshInterval: pluginCheckRunning ? 5000 : 0, revalidateOnFocus: false }
    );

    useEffect(() => {
        setPluginCheckRunning(!!pluginUpdates?.checking);
    }, [pluginUpdates?.checking]);

    const pluginUpdatesByFile = new Map((pluginUpdates?.plugins || []).map((plugin) => [plugin.fileName, plugin]));

    const onPluginsChanged = () => {
        mutatePluginUpdates();
        mutate();
    };

    const scrollToFirstPluginUpdate = () => {
        document.querySelector('[data-plugin-update="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const scrollToPluginVersionConflict = () => {
        document
            .querySelector('[data-plugin-version-conflict="true"]')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const sortedFiles = files ? sortFiles(files, directory, sortMode) : [];
    const pluginVersionConflicts = files && isPluginsDirectory(directory) ? findPluginVersionConflicts(files) : [];
    const pluginVersionConflictFiles = new Set<string>();

    pluginVersionConflicts.forEach((conflict) => {
        conflict.files.forEach((file) => pluginVersionConflictFiles.add(file));
    });

    // Map each duplicate to its relative position in the list so it can be marked on the scroll rail.
    const pluginConflictMarkers = sortedFiles
        .map((file, index) => ({ name: file.name, index }))
        .filter((entry) => pluginVersionConflictFiles.has(entry.name))
        .map((entry) => ({
            name: entry.name,
            ratio: sortedFiles.length > 1 ? entry.index / (sortedFiles.length - 1) : 0,
        }));

    if (error) {
        return <ServerError message={httpErrorToHuman(error)} onRetry={() => mutate()} />;
    }

    return (
        <ServerContentBlock title={'File Manager'} showFlashKey={'files'}>
            <PluginUpdatesContext.Provider
                value={{ enabled: inPluginsDirectory, byFile: pluginUpdatesByFile, open: setPluginModalFile }}
            >
                <FilesSubNavigation />
                <ErrorBoundary>
                    <div css={tw`flex flex-wrap-reverse md:flex-nowrap items-center mb-4`}>
                        <FileManagerBreadcrumbs
                            renderLeft={
                                <FileActionCheckbox
                                    type={'checkbox'}
                                    css={tw`mx-4`}
                                    checked={selectedFilesLength === (files?.length === 0 ? -1 : files?.length)}
                                    onChange={onSelectAllClick}
                                />
                            }
                        />
                        <div
                            css={tw`flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto md:flex-1 md:justify-end mt-4 md:mt-0`}
                        >
                            <div css={tw`flex items-center flex-shrink-0`}>
                                <label
                                    htmlFor={'sort-files'}
                                    css={tw`text-xs font-medium tracking-wide uppercase text-neutral-400 mr-2 whitespace-nowrap`}
                                >
                                    Sort by
                                </label>
                                <Select
                                    id={'sort-files'}
                                    value={sortMode}
                                    onChange={onSortModeChange}
                                    css={tw`w-full sm:w-auto py-2`}
                                >
                                    <option value={'name_asc'}>Name (A–Z)</option>
                                    <option value={'name_desc'}>Name (Z–A)</option>
                                    <option value={'modified_desc'}>Last modified</option>
                                    <option value={'size_desc'}>Size (largest first)</option>
                                </Select>
                            </div>
                            <Can action={'file.create'}>
                                <div className={style.manager_actions}>
                                    <FileManagerStatus />
                                    <NewDirectoryButton />
                                    <UploadButton />
                                    <NavLink to={`/server/${id}/files/new${window.location.hash}`}>
                                        <Button>New File</Button>
                                    </NavLink>
                                </div>
                            </Can>
                        </div>
                    </div>
                </ErrorBoundary>
                {!files ? (
                    <Spinner size={'large'} centered />
                ) : (
                    <>
                        {!files.length ? (
                            <p css={tw`text-sm text-neutral-400 text-center`}>This directory seems to be empty.</p>
                        ) : (
                            <CSSTransition classNames={'fade'} timeout={150} appear in>
                                <div>
                                    <PluginConflictScrollMarkers markers={pluginConflictMarkers} />
                                    {inPluginsDirectory && (
                                        <PluginUpdatesBar
                                            data={pluginUpdates}
                                            onChanged={onPluginsChanged}
                                            onShowFirst={scrollToFirstPluginUpdate}
                                        />
                                    )}
                                    {pluginVersionConflicts.length > 0 && (
                                        <Alert type={'danger'} className={'mb-4'}>
                                            <span className={'text-sm'}>
                                                Possible duplicate plugin versions detected.
                                            </span>
                                            <Button
                                                type={'button'}
                                                size={'xsmall'}
                                                color={'red'}
                                                isSecondary
                                                css={tw`ml-auto`}
                                                onClick={scrollToPluginVersionConflict}
                                            >
                                                Show
                                            </Button>
                                        </Alert>
                                    )}
                                    {files.length > FILE_DISPLAY_LIMIT && (
                                        <div css={tw`rounded bg-yellow-400 mb-px p-3`}>
                                            <p css={tw`text-yellow-900 text-sm text-center`}>
                                                This directory is too large to display in the browser, limiting the
                                                output to the first {FILE_DISPLAY_LIMIT} files in the current sort
                                                order.
                                            </p>
                                        </div>
                                    )}
                                    {sortedFiles.map((file) => (
                                        <FileObjectRow
                                            key={file.key}
                                            file={file}
                                            hasPluginVersionConflict={pluginVersionConflictFiles.has(file.name)}
                                        />
                                    ))}
                                    <MassActionsBar />
                                </div>
                            </CSSTransition>
                        )}
                    </>
                )}
                <PluginUpdateModal
                    plugin={pluginModalFile ? pluginUpdatesByFile.get(pluginModalFile) || null : null}
                    onClose={() => setPluginModalFile(null)}
                    onChanged={onPluginsChanged}
                />
            </PluginUpdatesContext.Provider>
        </ServerContentBlock>
    );
};
