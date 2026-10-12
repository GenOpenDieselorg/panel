import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router';
import { basename, dirname, join } from 'pathe';
import { format } from 'date-fns';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faDownload, faSyncAlt, faTimes } from '@fortawesome/free-solid-svg-icons';
import PageContentBlock from '@/components/elements/PageContentBlock';
import FileManagerBreadcrumbs from '@/components/server/files/FileManagerBreadcrumbs';
import Spinner from '@/components/elements/Spinner';
import { ServerContext } from '@/state/server';
import { encodePathSegments, hashToPath } from '@/helpers';
import { httpErrorToHuman } from '@/api/http';
import getLogFile from '@/api/server/files/getLogFile';
import getFileDownloadUrl from '@/api/server/files/getFileDownloadUrl';
import loadDirectory, { FileObject } from '@/api/server/files/loadDirectory';
import { bytesToString } from '@/lib/formatters';
import { isLogFile, LogLine, parseLog } from '@/lib/logFiles';

type Filter = 'all' | 'problems' | 'errors';

const ROW_HEIGHT = 20;
const OVERSCAN = 30;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const LEVEL_CLASS: Record<LogLine['level'], string> = {
    error: 'text-red-400',
    warn: 'text-yellow-300',
    info: 'text-gray-200',
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const Highlighted = ({ text, pattern }: { text: string; pattern: RegExp | null }) => {
    if (!pattern) return <>{text}</>;

    const parts = text.split(pattern);

    return (
        <>
            {parts.map((part, index) =>
                index % 2 === 1 ? (
                    <mark key={index} className={'bg-yellow-400 text-gray-900 rounded-sm px-px'}>
                        {part}
                    </mark>
                ) : (
                    <React.Fragment key={index}>{part}</React.Fragment>
                )
            )}
        </>
    );
};

// Read-only viewer for server logs, rotated .log.gz files and crash reports: errors in red,
// warnings in yellow, with search, a problems-only filter and a list of the directory's other logs.
export default () => {
    const history = useHistory();
    const { hash } = useLocation();
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const setDirectory = ServerContext.useStoreActions((actions) => actions.files.setDirectory);

    const filePath = hashToPath(hash);
    const directory = dirname(filePath);

    const [lines, setLines] = useState<LogLine[] | null>(null);
    const [error, setError] = useState('');
    const [siblings, setSiblings] = useState<FileObject[]>([]);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(600);
    const viewport = useRef<HTMLDivElement>(null);

    const load = () => {
        setError('');
        setLines(null);
        getLogFile(uuid, filePath)
            .then((contents) => setLines(parseLog(contents)))
            .catch((error) => setError(httpErrorToHuman(error)));
    };

    useEffect(() => {
        setDirectory(directory);
        load();
        viewport.current?.scrollTo({ top: 0 });
    }, [uuid, filePath]);

    useEffect(() => {
        loadDirectory(uuid, directory)
            .then((files) =>
                setSiblings(
                    files
                        .filter((file) => file.isFile && isLogFile(join(directory, file.name)))
                        .sort((a, b) => collator.compare(b.name, a.name))
                )
            )
            .catch(() => setSiblings([]));
    }, [uuid, directory]);

    useEffect(() => {
        const element = viewport.current;
        if (!element) return;

        const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
        observer.observe(element);

        return () => observer.disconnect();
    }, [lines !== null]);

    const counts = useMemo(
        () => ({
            errors: lines?.filter((line) => line.level === 'error').length ?? 0,
            warnings: lines?.filter((line) => line.level === 'warn').length ?? 0,
        }),
        [lines]
    );

    const pattern = useMemo(() => (query.trim() ? new RegExp(`(${escapeRegExp(query.trim())})`, 'i') : null), [query]);

    const visible = useMemo(() => {
        if (!lines) return [];

        return lines.filter((line) => {
            if (filter === 'errors' && line.level !== 'error') return false;
            if (filter === 'problems' && line.level === 'info') return false;

            return !pattern || pattern.test(line.text);
        });
    }, [lines, filter, pattern]);

    useEffect(() => {
        viewport.current?.scrollTo({ top: 0 });
    }, [filter, query]);

    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(visible.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
    const gutter = `${String(lines?.length ?? 0).length + 1}ch`;

    const onDownload = () => {
        getFileDownloadUrl(uuid, filePath)
            .then((url) => {
                // @ts-expect-error this is valid
                window.location = url;
            })
            .catch((error) => setError(httpErrorToHuman(error)));
    };

    const open = (file: FileObject) =>
        history.replace(`/server/${id}/files/edit#${encodePathSegments(join(directory, file.name))}`);

    return (
        <PageContentBlock>
            <div className={'mb-4'}>
                <FileManagerBreadcrumbs withinFileEditor isNewFile={false} />
            </div>
            <div className={'flex flex-col lg:flex-row rounded-lg overflow-hidden border border-gray-600 bg-gray-800'}>
                <aside className={'lg:w-64 flex-none bg-gray-700 max-h-48 lg:max-h-[75vh] overflow-y-auto p-2'}>
                    <p className={'px-2 pt-1 pb-2 text-2xs uppercase tracking-wider text-gray-400'}>Logs</p>
                    {siblings.map((file) => (
                        <button
                            key={file.key}
                            type={'button'}
                            onClick={() => open(file)}
                            className={`w-full text-left rounded px-2 py-1.5 mb-px ${
                                file.name === basename(filePath)
                                    ? 'bg-blue-600 text-white'
                                    : 'text-gray-200 hover:bg-gray-600'
                            }`}
                        >
                            <span className={'block text-sm font-medium truncate'}>{file.name}</span>
                            <span className={'block text-2xs opacity-70'}>
                                {bytesToString(file.size)} · {format(file.modifiedAt, 'dd-MM-yyyy, HH:mm')}
                            </span>
                        </button>
                    ))}
                </aside>
                <div className={'flex-1 min-w-0 flex flex-col'}>
                    <div className={'flex flex-wrap gap-2 p-2 bg-gray-700 border-b border-gray-600'}>
                        <div className={'relative flex-1 min-w-[12rem]'}>
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.currentTarget.value)}
                                placeholder={'Search this log...'}
                                className={
                                    'w-full rounded bg-gray-600 border border-gray-500 px-3 py-2 pr-8 text-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-400'
                                }
                            />
                            {query && (
                                <button
                                    type={'button'}
                                    onClick={() => setQuery('')}
                                    className={
                                        'absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-100'
                                    }
                                >
                                    <FontAwesomeIcon icon={faTimes} />
                                </button>
                            )}
                        </div>
                        <select
                            value={filter}
                            onChange={(e) => setFilter(e.currentTarget.value as Filter)}
                            className={'rounded bg-gray-600 border border-gray-500 px-3 py-2 text-sm text-gray-100'}
                        >
                            <option value={'all'}>All lines</option>
                            <option value={'problems'}>Warnings and errors ({counts.errors + counts.warnings})</option>
                            <option value={'errors'}>Errors only ({counts.errors})</option>
                        </select>
                        <button
                            type={'button'}
                            onClick={load}
                            className={
                                'rounded border border-gray-500 px-3 py-2 text-xs uppercase text-gray-200 hover:bg-gray-600'
                            }
                        >
                            <FontAwesomeIcon icon={faSyncAlt} className={'mr-1'} /> Refresh
                        </button>
                        <button
                            type={'button'}
                            onClick={onDownload}
                            className={
                                'rounded border border-gray-500 px-3 py-2 text-xs uppercase text-gray-200 hover:bg-gray-600'
                            }
                        >
                            <FontAwesomeIcon icon={faDownload} className={'mr-1'} /> Download
                        </button>
                        <button
                            type={'button'}
                            onClick={() => viewport.current?.scrollTo({ top: visible.length * ROW_HEIGHT })}
                            className={
                                'rounded border border-gray-500 px-3 py-2 text-xs uppercase text-gray-200 hover:bg-gray-600'
                            }
                        >
                            <FontAwesomeIcon icon={faArrowDown} className={'mr-1'} /> Bottom
                        </button>
                    </div>
                    <div className={'flex gap-4 px-3 py-1.5 text-xs bg-gray-800 border-b border-gray-700'}>
                        <span className={'text-gray-400'}>{lines?.length ?? 0} lines</span>
                        <span className={'text-red-400'}>{counts.errors} errors</span>
                        <span className={'text-yellow-300'}>{counts.warnings} warnings</span>
                        {(pattern || filter !== 'all') && (
                            <span className={'text-gray-400'}>{visible.length} shown</span>
                        )}
                    </div>
                    {error ? (
                        <p className={'p-6 text-sm text-red-400'}>{error}</p>
                    ) : !lines ? (
                        <div className={'p-10'}>
                            <Spinner centered />
                        </div>
                    ) : (
                        <div
                            ref={viewport}
                            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                            className={'h-[70vh] overflow-auto bg-gray-900 font-mono text-xs'}
                        >
                            <div
                                style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}
                                className={'w-max min-w-full'}
                            >
                                <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
                                    {visible.slice(start, end).map((line) => (
                                        <div
                                            key={line.number}
                                            className={'flex whitespace-pre hover:bg-gray-800'}
                                            style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
                                        >
                                            <span
                                                className={'flex-none text-right pr-3 text-gray-500 select-none'}
                                                style={{ width: gutter }}
                                            >
                                                {line.number}
                                            </span>
                                            <span className={`pr-4 ${LEVEL_CLASS[line.level]}`}>
                                                <Highlighted text={line.text} pattern={pattern} />
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </PageContentBlock>
    );
};
