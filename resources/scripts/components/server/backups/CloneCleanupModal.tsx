import React, { useEffect, useMemo, useState } from 'react';
import { ServerContext } from '@/state/server';
import Modal from '@/components/elements/Modal';
import tw from 'twin.macro';
import Button from '@/components/elements/Button';
import Input from '@/components/elements/Input';
import FlashMessageRender from '@/components/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import { applyCloneCleanup, CleanupMode, ClonePlugin, getCloneCleanupPlugins } from '@/api/server/cloneCleanup';
import useWebsocketEvent from '@/plugins/useWebsocketEvent';
import { SocketEvent } from '@/components/server/events';
import { matchPluginPatterns, parsePluginPatterns } from '@/lib/matchPluginPatterns';

const CloneCleanupModal = () => {
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const cloneCleanupPending = ServerContext.useStoreState((state) => state.server.data!.cloneCleanupPending);
    const status = ServerContext.useStoreState((state) => state.server.data?.status ?? null);
    const getServer = ServerContext.useStoreActions((actions) => actions.server.getServer);
    const setServerFromState = ServerContext.useStoreActions((actions) => actions.server.setServerFromState);

    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<CleanupMode>('remove');
    const [plugins, setPlugins] = useState<ClonePlugin[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [patternInput, setPatternInput] = useState('');
    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const patternMatches = useMemo(() => matchPluginPatterns(plugins, patternInput), [plugins, patternInput]);
    const parsedPatterns = useMemo(() => parsePluginPatterns(patternInput), [patternInput]);

    // In keep mode everything that was not ticked gets deleted.
    const deletionCount = mode === 'keep' ? plugins.length - selected.length : selected.length;

    const loadPlugins = () => {
        setLoading(true);
        clearFlashes('clone-cleanup');
        getCloneCleanupPlugins(uuid)
            .then(({ plugins: items, template, mode: storedMode, selection }) => {
                setPlugins(items);
                setMode(storedMode);

                // A choice made in the "Create Server" dialog wins; otherwise fall
                // back to the removal template so older clones keep working.
                if (storedMode === 'keep' || selection.length > 0) {
                    setPatternInput('');
                    setSelected(selection);
                } else {
                    setPatternInput(template);
                    setSelected(matchPluginPatterns(items, template));
                }

                setVisible(true);
            })
            .catch((error) => clearAndAddHttpError({ key: 'clone-cleanup', error }))
            .then(() => setLoading(false));
    };

    useEffect(() => {
        if (cloneCleanupPending && status === null) {
            loadPlugins();
        }
    }, [cloneCleanupPending, status]);

    useWebsocketEvent(SocketEvent.BACKUP_RESTORE_COMPLETED, () => {
        getServer(uuid)
            .then(() => loadPlugins())
            .catch((error) => console.error(error));
    });

    const togglePlugin = (name: string) => {
        setSelected((current) =>
            current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
        );
    };

    const onModeChange = (next: CleanupMode) => {
        if (next === mode) {
            return;
        }

        setMode(next);
        // Keep mode always starts from a clean slate — the user picks the few plugins they want.
        setSelected(next === 'remove' ? matchPluginPatterns(plugins, patternInput) : []);
    };

    const onPatternInputChange = (value: string) => {
        setPatternInput(value);
        setSelected(matchPluginPatterns(plugins, value));
    };

    const onConfirm = () => {
        setLoading(true);
        clearFlashes('clone-cleanup');
        applyCloneCleanup(
            uuid,
            mode,
            selected,
            mode === 'remove' && parsedPatterns.length > 0 ? parsedPatterns : undefined
        )
            .then(() => {
                setVisible(false);
                setServerFromState((s) => ({ ...s, cloneCleanupPending: false }));
            })
            .catch((error) => clearAndAddHttpError({ key: 'clone-cleanup', error }))
            .then(() => setLoading(false));
    };

    const onSkip = () => {
        setLoading(true);
        clearFlashes('clone-cleanup');
        applyCloneCleanup(uuid, 'remove', [])
            .then(() => {
                setVisible(false);
                setServerFromState((s) => ({ ...s, cloneCleanupPending: false }));
            })
            .catch((error) => clearAndAddHttpError({ key: 'clone-cleanup', error }))
            .then(() => setLoading(false));
    };

    return (
        <Modal
            visible={visible}
            onDismissed={() => setVisible(false)}
            closeOnBackground={false}
            showSpinnerOverlay={loading}
        >
            <FlashMessageRender key={'clone-cleanup'} css={tw`mb-4`} />
            <h2 css={tw`text-2xl mb-4 text-neutral-100`}>Clean Up Plugins</h2>
            <div css={tw`flex gap-2 mb-4`}>
                <Button
                    size={'small'}
                    color={'primary'}
                    isSecondary={mode !== 'remove'}
                    onClick={() => onModeChange('remove')}
                >
                    Remove selected
                </Button>
                <Button
                    size={'small'}
                    color={'primary'}
                    isSecondary={mode !== 'keep'}
                    onClick={() => onModeChange('keep')}
                >
                    Keep only selected
                </Button>
            </div>
            <p css={tw`text-neutral-300 mb-4`}>
                {mode === 'remove' ? (
                    <>
                        The backup has been restored to this server. Every plugin you tick below will be deleted from{' '}
                        <code css={tw`text-neutral-200`}>/plugins</code>.
                    </>
                ) : (
                    <>
                        Tick only the plugins this server needs. Every other jar in{' '}
                        <code css={tw`text-neutral-200`}>/plugins</code> will be deleted.
                    </>
                )}{' '}
                Only <code css={tw`text-neutral-200`}>.jar</code> files are listed — folders are never touched.
            </p>
            {mode === 'remove' && (
                <div css={tw`mb-4`}>
                    <label htmlFor={'clone_plugin_patterns'} css={tw`text-sm text-neutral-300 block mb-2`}>
                        Plugin Removal Template
                    </label>
                    <Input
                        id={'clone_plugin_patterns'}
                        value={patternInput}
                        onChange={(e) => onPatternInputChange(e.target.value)}
                        placeholder={'luckperms*,litebans*,coreprotect*,goxy*'}
                    />
                    <p css={tw`text-xs text-neutral-400 mt-2`}>
                        Case-insensitive matching. Pattern <code css={tw`text-neutral-300`}>goxy*</code> matches{' '}
                        <code css={tw`text-neutral-300`}>Goxy.jar</code>. Directories are skipped.
                    </p>
                    {parsedPatterns.length > 0 && (
                        <p css={tw`text-xs text-neutral-300 mt-2`}>
                            Matched {patternMatches.length} file{patternMatches.length === 1 ? '' : 's'}.
                        </p>
                    )}
                </div>
            )}
            {plugins.length > 0 ? (
                <>
                    <div css={tw`flex items-center justify-between mb-2`}>
                        <span css={tw`text-xs text-neutral-400`}>
                            {selected.length} of {plugins.length} selected
                        </span>
                        <div css={tw`flex gap-3`}>
                            <button
                                type={'button'}
                                css={tw`text-xs text-neutral-300 hover:text-neutral-100`}
                                onClick={() => setSelected(plugins.map((plugin) => plugin.name))}
                            >
                                Select all
                            </button>
                            <button
                                type={'button'}
                                css={tw`text-xs text-neutral-300 hover:text-neutral-100`}
                                onClick={() => setSelected([])}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    <div css={tw`space-y-2 max-h-96 overflow-y-auto mb-4`}>
                        {plugins.map((plugin) => (
                            <label
                                key={plugin.name}
                                htmlFor={`plugin_${plugin.name}`}
                                css={tw`flex items-center cursor-pointer bg-neutral-700 rounded p-3`}
                            >
                                <Input
                                    id={`plugin_${plugin.name}`}
                                    type={'checkbox'}
                                    css={tw`w-5! h-5! mr-3`}
                                    checked={selected.includes(plugin.name)}
                                    onChange={() => togglePlugin(plugin.name)}
                                />
                                <span css={tw`text-neutral-100`}>{plugin.name}</span>
                            </label>
                        ))}
                    </div>
                    <p css={[tw`text-sm mb-6`, deletionCount > 0 ? tw`text-red-400` : tw`text-neutral-400`]}>
                        {deletionCount === 0
                            ? 'Nothing will be deleted.'
                            : `${deletionCount} plugin${deletionCount === 1 ? '' : 's'} will be deleted.`}
                    </p>
                </>
            ) : (
                <p css={tw`text-neutral-400 mb-6`}>No plugin jars were found in the /plugins directory.</p>
            )}
            <div css={tw`flex justify-end gap-3`}>
                <Button isSecondary onClick={onSkip}>
                    Skip
                </Button>
                <Button color={'red'} disabled={deletionCount === 0} onClick={onConfirm}>
                    {mode === 'remove' ? 'Remove Selected' : 'Keep Selected'}
                </Button>
            </div>
        </Modal>
    );
};

export default CloneCleanupModal;
