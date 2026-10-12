import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Dialog } from '@/components/elements/dialog';
import { Button } from '@/components/elements/button/index';
import Input from '@/components/elements/Input';
import Spinner from '@/components/elements/Spinner';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import FlashMessageRender from '@/components/FlashMessageRender';
import { ServerContext } from '@/state/server';
import { useFlashKey } from '@/plugins/useFlash';
import {
    getPluginVersions,
    getServerGameVersion,
    InstalledPlugin,
    installPlugin,
    PluginSource,
    PluginStoreResult,
    PluginStoreVersion,
    searchPlugins,
} from '@/api/server/plugins/pluginStore';

const FLASH_KEY = 'plugin-store';
const GAME_VERSION_KEY = (uuid: string) => `pterodactyl:plugin-store:mc:${uuid}`;

const formatDownloads = (count: number): string =>
    count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : count >= 1e3 ? `${Math.round(count / 1e3)}k` : String(count);

// Modrinth lists every supported version, so a long list is shown as its first-to-last range.
const formatGameVersions = (versions: string[]): string =>
    versions.length > 4 ? `${versions[0]} – ${versions[versions.length - 1]}` : versions.join(', ');

const CompatBadge = ({ compatible, gameVersion }: { compatible: boolean | null; gameVersion: string }) => {
    if (!gameVersion) return null;

    if (compatible === null) {
        return (
            <span className={'text-2xs rounded px-1.5 py-0.5 bg-gray-600 text-gray-300'}>compatibility unknown</span>
        );
    }

    return compatible ? (
        <span className={'text-2xs rounded px-1.5 py-0.5 bg-green-600 text-green-50 whitespace-nowrap'}>
            ✓ {gameVersion}
        </span>
    ) : (
        <span className={'text-2xs rounded px-1.5 py-0.5 bg-yellow-600 text-yellow-50'}>
            not tested on {gameVersion}
        </span>
    );
};

export default ({ open, onClose, onInstalled }: { open: boolean; onClose: () => void; onInstalled: () => void }) => {
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const { clearFlashes, clearAndAddHttpError } = useFlashKey(FLASH_KEY);

    const [gameVersion, setGameVersion] = useState('');
    const [source, setSource] = useState<PluginSource>('modrinth');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PluginStoreResult[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<PluginStoreResult | null>(null);
    const [versions, setVersions] = useState<PluginStoreVersion[] | null>(null);
    const [installing, setInstalling] = useState(false);
    const [installed, setInstalled] = useState<InstalledPlugin | null>(null);

    useEffect(() => {
        if (!open) return;

        clearFlashes();
        setSelected(null);
        setInstalled(null);

        let stored = '';
        try {
            stored = localStorage.getItem(GAME_VERSION_KEY(uuid)) || '';
        } catch {
            // Storage can be unavailable; fall back to detection.
        }

        setGameVersion(stored);
        if (!stored) {
            getServerGameVersion(uuid)
                .then((detected) => detected && setGameVersion((current) => current || detected))
                .catch(() => undefined);
        }
    }, [open]);

    const onGameVersionChange = (value: string) => {
        setGameVersion(value);
        try {
            localStorage.setItem(GAME_VERSION_KEY(uuid), value);
        } catch {
            // ignore
        }
    };

    const search = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!query.trim()) return;

        clearFlashes();
        setSelected(null);
        setSearching(true);
        searchPlugins(uuid, source, query.trim(), gameVersion.trim())
            .then(setResults)
            .catch((error) => clearAndAddHttpError(error))
            .finally(() => setSearching(false));
    };

    useEffect(() => {
        if (open && query.trim()) search();
    }, [source]);

    const select = (result: PluginStoreResult) => {
        clearFlashes();
        setSelected(result);
        setVersions(null);
        getPluginVersions(uuid, result.source, result.project, gameVersion.trim())
            .then(setVersions)
            .catch((error) => clearAndAddHttpError(error));
    };

    const install = (version: PluginStoreVersion) => {
        if (!selected) return;

        clearFlashes();
        setInstalling(true);
        installPlugin(uuid, selected.source, selected.project, selected.source === 'modrinth' ? version.id : null)
            .then((plugin) => {
                setInstalled(plugin);
                onInstalled();
            })
            .catch((error) => clearAndAddHttpError(error))
            .finally(() => setInstalling(false));
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            preventExternalClose={installing}
            title={'Add plugin'}
            description={'Minecraft plugins from Modrinth or SpigotMC, matched to the server version.'}
        >
            <SpinnerOverlay visible={installing} size={'large'}>
                Downloading and installing...
            </SpinnerOverlay>
            <FlashMessageRender byKey={FLASH_KEY} className={'mb-4'} />

            {installed ? (
                <div className={'rounded bg-green-600/20 border border-green-600 p-4 text-sm text-green-50'}>
                    Installed <strong>{installed.pluginName}</strong> {installed.pluginVersion} as{' '}
                    <code>plugins/{installed.fileName}</code>. Restart the server to load it.
                </div>
            ) : (
                <>
                    <form onSubmit={search} className={'flex flex-wrap gap-2'}>
                        <div className={'w-28 flex-none'}>
                            <Input
                                value={gameVersion}
                                placeholder={'1.21.8'}
                                title={'Server Minecraft version'}
                                onChange={(e) => onGameVersionChange(e.currentTarget.value)}
                            />
                        </div>
                        <div className={'flex-1 min-w-[10rem]'}>
                            <Input
                                value={query}
                                placeholder={'Plugin name...'}
                                autoFocus
                                onChange={(e) => setQuery(e.currentTarget.value)}
                            />
                        </div>
                        <Button type={'submit'} disabled={!query.trim() || searching}>
                            Search
                        </Button>
                    </form>
                    <div className={'flex gap-1 mt-3'}>
                        {(['modrinth', 'spigot'] as PluginSource[]).map((value) => (
                            <button
                                key={value}
                                type={'button'}
                                onClick={() => setSource(value)}
                                className={`rounded px-3 py-1 text-sm ${
                                    source === value ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                {value === 'modrinth' ? 'Modrinth' : 'SpigotMC'}
                            </button>
                        ))}
                        <span className={'ml-auto self-center text-2xs text-gray-400'}>
                            {source === 'spigot'
                                ? 'Only free resources hosted on SpigotMC.'
                                : gameVersion
                                ? `Only versions for MC ${gameVersion}.`
                                : 'Enter an MC version to filter.'}
                        </span>
                    </div>

                    <div className={'mt-3 max-h-[55vh] overflow-y-auto'}>
                        {selected ? (
                            <div>
                                <button
                                    type={'button'}
                                    onClick={() => setSelected(null)}
                                    className={'text-sm text-cyan-400 hover:underline mb-2'}
                                >
                                    ← results
                                </button>
                                <p className={'text-gray-100 font-medium'}>
                                    {selected.title}{' '}
                                    <a
                                        href={selected.url}
                                        target={'_blank'}
                                        rel={'noopener noreferrer'}
                                        className={'text-xs text-cyan-400 hover:underline'}
                                    >
                                        project page
                                    </a>
                                </p>
                                {!versions ? (
                                    <Spinner centered />
                                ) : !versions.length ? (
                                    <p className={'text-sm text-gray-400 py-4'}>
                                        No downloadable versions{gameVersion ? ` for MC ${gameVersion}` : ''}.
                                    </p>
                                ) : (
                                    versions.map((version) => (
                                        <div
                                            key={version.id}
                                            className={'flex items-center gap-3 py-2 border-b border-gray-600 text-sm'}
                                        >
                                            <div className={'flex-1 min-w-0'}>
                                                <p className={'text-gray-100 truncate'}>
                                                    {version.name}
                                                    {version.type !== 'release' && (
                                                        <span className={'ml-2 text-2xs text-yellow-400'}>
                                                            {version.type}
                                                        </span>
                                                    )}
                                                </p>
                                                <p className={'text-2xs text-gray-400 truncate'}>
                                                    {version.publishedAt && format(version.publishedAt, 'dd-MM-yyyy')}
                                                    {version.gameVersions.length > 0 &&
                                                        ` · MC ${formatGameVersions(version.gameVersions)}`}
                                                </p>
                                            </div>
                                            {selected.source === 'modrinth' && gameVersion && (
                                                <CompatBadge
                                                    compatible={version.gameVersions.includes(gameVersion.trim())}
                                                    gameVersion={gameVersion.trim()}
                                                />
                                            )}
                                            {selected.source === 'spigot' && (
                                                <CompatBadge
                                                    compatible={version.compatible}
                                                    gameVersion={gameVersion}
                                                />
                                            )}
                                            <Button size={Button.Sizes.Small} onClick={() => install(version)}>
                                                Install
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </div>
                        ) : searching ? (
                            <Spinner centered />
                        ) : results && !results.length ? (
                            <p className={'text-sm text-gray-400 text-center py-4'}>Nothing found.</p>
                        ) : (
                            results?.map((result) => (
                                <button
                                    key={`${result.source}:${result.project}`}
                                    type={'button'}
                                    onClick={() => select(result)}
                                    className={
                                        'w-full flex items-center gap-3 text-left rounded p-2 hover:bg-gray-600 border-b border-gray-600'
                                    }
                                >
                                    {result.iconUrl ? (
                                        <img src={result.iconUrl} alt={''} className={'w-10 h-10 rounded flex-none'} />
                                    ) : (
                                        <div className={'w-10 h-10 rounded bg-gray-600 flex-none'} />
                                    )}
                                    <div className={'flex-1 min-w-0'}>
                                        <p className={'text-sm text-gray-100 truncate'}>
                                            {result.title}
                                            {result.author && (
                                                <span className={'text-xs text-gray-400'}> · {result.author}</span>
                                            )}
                                        </p>
                                        <p className={'text-xs text-gray-400 truncate'}>{result.description}</p>
                                    </div>
                                    <div className={'flex flex-col items-end gap-1 flex-none'}>
                                        <span className={'text-2xs text-gray-400'}>
                                            {formatDownloads(result.downloads)} downloads
                                        </span>
                                        {result.source === 'spigot' && (
                                            <CompatBadge compatible={result.compatible} gameVersion={gameVersion} />
                                        )}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </>
            )}
            <Dialog.Footer>
                <Button.Text onClick={onClose}>Close</Button.Text>
            </Dialog.Footer>
        </Dialog>
    );
};
