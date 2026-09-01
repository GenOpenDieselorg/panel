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

const FILE_DISPLAY_LIMIT = 400;

type SortMode = 'name_asc' | 'name_desc' | 'modified_desc' | 'size_desc';

const SORT_MODES: SortMode[] = ['name_asc', 'name_desc', 'modified_desc', 'size_desc'];

const isSortMode = (value: unknown): value is SortMode => SORT_MODES.includes(value as SortMode);

const SORT_STORAGE_KEY = 'pterodactyl:files:sort';
const DEFAULT_SORT_MODE: SortMode = 'name_asc';

const isPluginsDirectory = (directory: string): boolean => cleanDirectoryPath(directory) === '/plugins';

const isLogsDirectory = (directory: string): boolean => {
    const path = cleanDirectoryPath(directory);

    return path === '/logs' || path.startsWith('/logs/');
};

// Places directories before files while keeping the ordering produced by the active sort mode.
const directoriesFirst = (a: FileObject, b: FileObject): number => (a.isFile === b.isFile ? 0 : a.isFile ? 1 : -1);

const sortFiles = (files: FileObject[], directory: string, sortMode: SortMode): FileObject[] => {
    const sortedFiles = [...files].slice(0, FILE_DISPLAY_LIMIT);

    // The logs directory is always presented newest-first regardless of the selected sort mode.
    const effectiveSortMode: SortMode = isLogsDirectory(directory) ? 'modified_desc' : sortMode;

    switch (effectiveSortMode) {
        case 'name_desc':
            sortedFiles.sort((a, b) => b.name.localeCompare(a.name)).sort(directoriesFirst);
            break;
        case 'modified_desc':
            sortedFiles.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
            break;
        case 'size_desc':
            sortedFiles.sort((a, b) => b.size - a.size).sort(directoriesFirst);
            break;
        case 'name_asc':
        default:
            sortedFiles.sort((a, b) => a.name.localeCompare(b.name)).sort(directoriesFirst);
            break;
    }

    return sortedFiles.filter((file, index) => index === 0 || file.name !== sortedFiles[index - 1].name);
};

export default () => {
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
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
                                {pluginVersionConflicts.length > 0 && (
                                    <Alert type={'danger'} className={'mb-4'}>
                                        <span className={'text-sm'}>Possible duplicate plugin versions detected.</span>
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
                                            This directory is too large to display in the browser, limiting the output
                                            to the first {FILE_DISPLAY_LIMIT} files.
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
        </ServerContentBlock>
    );
};
