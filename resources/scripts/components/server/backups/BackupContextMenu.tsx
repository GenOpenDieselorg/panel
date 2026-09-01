import React, { useEffect, useState } from 'react';
import {
    faBoxOpen,
    faCloudDownloadAlt,
    faEllipsisH,
    faLock,
    faPlus,
    faTrashAlt,
    faUnlock,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import DropdownMenu, { DropdownButtonRow } from '@/components/elements/DropdownMenu';
import getBackupDownloadUrl from '@/api/server/backups/getBackupDownloadUrl';
import useFlash from '@/plugins/useFlash';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import deleteBackup from '@/api/server/backups/deleteBackup';
import Can from '@/components/elements/Can';
import tw from 'twin.macro';
import getServerBackups from '@/api/swr/getServerBackups';
import { ServerBackup } from '@/api/server/types';
import { ServerContext } from '@/state/server';
import Input from '@/components/elements/Input';
import Select from '@/components/elements/Select';
import InputSpinner from '@/components/elements/InputSpinner';
import { restoreServerBackup } from '@/api/server/backups';
import createServerFromBackup from '@/api/server/backups/createServerFromBackup';
import getCreateServerNodes from '@/api/server/backups/getCreateServerNodes';
import { getPaperVersions } from '@/api/server/startup/getPaperVersions';
import CreateServerNodeSelector from '@/components/server/backups/CreateServerNodeSelector';
import http, { httpErrorToHuman } from '@/api/http';
import { Dialog } from '@/components/elements/dialog';
import { useStoreState } from '@/state/hooks';
import { generateCloneServerName } from '@/lib/generateCloneServerName';
import loadDirectory from '@/api/server/files/loadDirectory';
import PluginSelector from '@/components/server/backups/PluginSelector';
import { CleanupMode, ClonePlugin } from '@/api/server/cloneCleanup';

interface Props {
    backup: ServerBackup;
}

export default ({ backup }: Props) => {
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const sourceServerName = ServerContext.useStoreState((state) => state.server.data!.name);
    const setServerFromState = ServerContext.useStoreActions((actions) => actions.server.setServerFromState);
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const canDeleteBackup = !backup.isProtected || rootAdmin;
    const [modal, setModal] = useState('');
    const [loading, setLoading] = useState(false);
    const [truncate, setTruncate] = useState(false);
    const [serverName, setServerName] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
    const [cloneMemoryGiB, setCloneMemoryGiB] = useState(3);
    const [pluginTemplate, setPluginTemplate] = useState('');
    const [pluginMode, setPluginMode] = useState<CleanupMode>('remove');
    const [plugins, setPlugins] = useState<ClonePlugin[]>([]);
    const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
    const [loadingPlugins, setLoadingPlugins] = useState(false);
    const [paperVersions, setPaperVersions] = useState<string[]>([]);
    const [selectedPaperVersion, setSelectedPaperVersion] = useState('');
    const [loadingPaperVersions, setLoadingPaperVersions] = useState(false);
    const { clearFlashes, clearAndAddHttpError, addFlash } = useFlash();

    const resetCreateServerState = () => {
        setServerName('');
        setSelectedNodeId(null);
        setCloneMemoryGiB(3);
        setPluginTemplate('');
        setPluginMode('remove');
        setPlugins([]);
        setSelectedPlugins([]);
        setPaperVersions([]);
        setSelectedPaperVersion('');
    };

    useEffect(() => {
        if (modal !== 'create-server') {
            return;
        }

        getCreateServerNodes(uuid)
            .then((data) => setPluginTemplate(data.plugin_template || ''))
            .catch((error) => console.error(error));

        // The backup mirrors this server, so its /plugins directory is exactly
        // what the new server will end up with.
        setLoadingPlugins(true);
        loadDirectory(uuid, '/plugins')
            .then((files) =>
                setPlugins(
                    files
                        .filter((file) => file.isFile && file.name.toLowerCase().endsWith('.jar'))
                        .map((file) => ({ name: file.name, type: 'file' as const }))
                        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                )
            )
            .catch((error) => console.error(error))
            .then(() => setLoadingPlugins(false));

        setLoadingPaperVersions(true);
        getPaperVersions(uuid)
            .then(({ versions }) => {
                setPaperVersions(versions);
                setSelectedPaperVersion(versions[0] || '');
            })
            .catch((error) => clearAndAddHttpError({ key: 'backups', error }))
            .then(() => setLoadingPaperVersions(false));
    }, [modal, uuid]);
    const { mutate } = getServerBackups();

    const doDownload = () => {
        setLoading(true);
        clearFlashes('backups');
        getBackupDownloadUrl(uuid, backup.uuid)
            .then((url) => {
                // @ts-expect-error this is valid
                window.location = url;
            })
            .catch((error) => {
                console.error(error);
                clearAndAddHttpError({ key: 'backups', error });
            })
            .then(() => setLoading(false));
    };

    const doDeletion = () => {
        setLoading(true);
        clearFlashes('backups');
        deleteBackup(uuid, backup.uuid)
            .then(() =>
                mutate(
                    (data) => ({
                        ...data,
                        items: data.items.filter((b) => b.uuid !== backup.uuid),
                        backupCount: data.backupCount - 1,
                    }),
                    false
                )
            )
            .catch((error) => {
                console.error(error);
                clearAndAddHttpError({ key: 'backups', error });
                setLoading(false);
                setModal('');
            });
    };

    const doRestorationAction = () => {
        setLoading(true);
        clearFlashes('backups');
        restoreServerBackup(uuid, backup.uuid, truncate)
            .then(() =>
                setServerFromState((s) => ({
                    ...s,
                    status: 'restoring_backup',
                }))
            )
            .catch((error) => {
                console.error(error);
                clearAndAddHttpError({ key: 'backups', error });
            })
            .then(() => setLoading(false))
            .then(() => setModal(''));
    };

    const doCreateServer = () => {
        if (selectedNodeId === null) {
            clearFlashes('backups');
            addFlash({
                key: 'backups',
                type: 'error',
                message: 'Select a node where the new server should be created.',
            });
            return;
        }

        if (pluginMode === 'keep' && selectedPlugins.length === 0 && plugins.length > 0) {
            clearFlashes('backups');
            addFlash({
                key: 'backups',
                type: 'error',
                message: 'Select at least one plugin to keep, or switch back to "Remove selected".',
            });
            return;
        }

        setLoading(true);
        clearFlashes('backups');
        createServerFromBackup(
            uuid,
            backup.uuid,
            serverName || undefined,
            selectedNodeId,
            pluginTemplate,
            cloneMemoryGiB * 1024,
            selectedPaperVersion || undefined,
            pluginMode,
            selectedPlugins
        )
            .then((server) => {
                addFlash({
                    key: 'backups',
                    type: 'success',
                    message: 'A new server has been created and the backup restoration process has started.',
                });
                window.open(`/server/${server.identifier}`, '_blank');
                setModal('');
                resetCreateServerState();
            })
            .catch((error) => {
                console.error(error);
                clearAndAddHttpError({ key: 'backups', error });
            })
            .then(() => setLoading(false));
    };

    const onLockToggle = () => {
        if (backup.isLocked && modal !== 'unlock') {
            return setModal('unlock');
        }

        http.post(`/api/client/servers/${uuid}/backups/${backup.uuid}/lock`)
            .then(() =>
                mutate(
                    (data) => ({
                        ...data,
                        items: data.items.map((b) =>
                            b.uuid !== backup.uuid
                                ? b
                                : {
                                      ...b,
                                      isLocked: !b.isLocked,
                                  }
                        ),
                    }),
                    false
                )
            )
            .catch((error) => alert(httpErrorToHuman(error)))
            .then(() => setModal(''));
    };

    return (
        <>
            <Dialog.Confirm
                open={modal === 'unlock'}
                onClose={() => setModal('')}
                title={`Unlock "${backup.name}"`}
                onConfirmed={onLockToggle}
            >
                This backup will no longer be protected from automated or accidental deletions.
            </Dialog.Confirm>
            <Dialog.Confirm
                open={modal === 'restore'}
                onClose={() => setModal('')}
                confirm={'Restore'}
                title={`Restore "${backup.name}"`}
                onConfirmed={() => doRestorationAction()}
            >
                <p>
                    Your server will be stopped. You will not be able to control the power state, access the file
                    manager, or create additional backups until completed.
                </p>
                <p css={tw`mt-4 -mb-2 bg-gray-700 p-3 rounded`}>
                    <label htmlFor={'restore_truncate'} css={tw`text-base flex items-center cursor-pointer`}>
                        <Input
                            type={'checkbox'}
                            css={tw`text-red-500! w-5! h-5! mr-2`}
                            id={'restore_truncate'}
                            value={'true'}
                            checked={truncate}
                            onChange={() => setTruncate((s) => !s)}
                        />
                        Delete all files before restoring backup.
                    </label>
                </p>
            </Dialog.Confirm>
            <Dialog.Confirm
                open={modal === 'create-server'}
                onClose={() => {
                    setModal('');
                    resetCreateServerState();
                }}
                confirm={'Create Server'}
                title={`Create Server from "${backup.name}"`}
                onConfirmed={doCreateServer}
            >
                <p>
                    A new server will be provisioned with the same disk and limits as this server, CPU set to 300%, and
                    the selected RAM limit. The selected backup will be restored to the new instance, then the plugin
                    choice below is applied.
                </p>
                <div css={tw`mt-4 -mb-2 bg-gray-700 p-3 rounded`}>
                    <div css={tw`flex items-center justify-between mb-2`}>
                        <label htmlFor={'clone_memory'} css={tw`text-base font-medium`}>
                            RAM
                        </label>
                        <span css={tw`text-sm text-neutral-300`}>{cloneMemoryGiB} GB</span>
                    </div>
                    <input
                        id={'clone_memory'}
                        type={'range'}
                        min={2}
                        max={10}
                        step={1}
                        value={cloneMemoryGiB}
                        onChange={(e) => setCloneMemoryGiB(Number(e.target.value))}
                        css={tw`w-full cursor-pointer`}
                    />
                    <div css={tw`flex justify-between text-xs text-neutral-400 mt-1`}>
                        <span>2 GB</span>
                        <span>10 GB</span>
                    </div>
                </div>
                <div css={tw`mt-4 -mb-2 bg-gray-700 p-3 rounded`}>
                    <CreateServerNodeSelector
                        serverUuid={uuid}
                        selectedNodeId={selectedNodeId}
                        memoryMiB={cloneMemoryGiB * 1024}
                        onSelect={setSelectedNodeId}
                    />
                </div>
                <p css={tw`mt-4 -mb-2 bg-gray-700 p-3 rounded`}>
                    <label htmlFor={'clone_paper_version'} css={tw`text-base block mb-2`}>
                        Paper Version
                    </label>
                    <InputSpinner visible={loadingPaperVersions}>
                        <Select
                            id={'clone_paper_version'}
                            value={selectedPaperVersion}
                            disabled={loadingPaperVersions || paperVersions.length === 0}
                            onChange={(e) => setSelectedPaperVersion(e.target.value)}
                        >
                            {paperVersions.length === 0 ? (
                                <option value={''}>No Paper versions available</option>
                            ) : (
                                paperVersions.map((version) => (
                                    <option key={version} value={version}>
                                        {version}
                                    </option>
                                ))
                            )}
                        </Select>
                    </InputSpinner>
                    <span css={tw`text-xs text-neutral-400 mt-2 block`}>
                        Latest build for the selected Paper version will be downloaded after the backup restore
                        finishes.
                    </span>
                </p>
                <p css={tw`mt-4 -mb-2 bg-gray-700 p-3 rounded`}>
                    <label htmlFor={'clone_server_name'} css={tw`text-base block mb-2`}>
                        Server Name (Optional)
                    </label>
                    <Input
                        id={'clone_server_name'}
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        placeholder={generateCloneServerName(sourceServerName)}
                    />
                </p>
                <div css={tw`mt-4 -mb-2 bg-gray-700 p-3 rounded`}>
                    <label css={tw`text-base block mb-2`}>Plugins</label>
                    <PluginSelector
                        plugins={plugins}
                        loading={loadingPlugins}
                        mode={pluginMode}
                        selected={selectedPlugins}
                        onModeChange={(next) => {
                            setPluginMode(next);
                            setSelectedPlugins([]);
                        }}
                        onSelectedChange={setSelectedPlugins}
                    />
                </div>
            </Dialog.Confirm>
            <Dialog.Confirm
                title={`Delete "${backup.name}"`}
                confirm={'Continue'}
                open={modal === 'delete'}
                onClose={() => setModal('')}
                onConfirmed={doDeletion}
            >
                This is a permanent operation. The backup cannot be recovered once deleted.
            </Dialog.Confirm>
            <SpinnerOverlay visible={loading} fixed />
            {backup.isSuccessful ? (
                <DropdownMenu
                    renderToggle={(onClick) => (
                        <button
                            onClick={onClick}
                            css={tw`text-gray-200 transition-colors duration-150 hover:text-gray-100 p-2`}
                        >
                            <FontAwesomeIcon icon={faEllipsisH} />
                        </button>
                    )}
                >
                    <div css={tw`text-sm`}>
                        <Can action={'backup.download'}>
                            <DropdownButtonRow onClick={doDownload}>
                                <FontAwesomeIcon fixedWidth icon={faCloudDownloadAlt} css={tw`text-xs`} />
                                <span css={tw`ml-2`}>Download</span>
                            </DropdownButtonRow>
                        </Can>
                        <Can action={'backup.restore'}>
                            <DropdownButtonRow onClick={() => setModal('restore')}>
                                <FontAwesomeIcon fixedWidth icon={faBoxOpen} css={tw`text-xs`} />
                                <span css={tw`ml-2`}>Restore</span>
                            </DropdownButtonRow>
                            <DropdownButtonRow onClick={() => setModal('create-server')}>
                                <FontAwesomeIcon fixedWidth icon={faPlus} css={tw`text-xs`} />
                                <span css={tw`ml-2`}>Create Server</span>
                            </DropdownButtonRow>
                        </Can>
                        <Can action={'backup.delete'}>
                            <>
                                <DropdownButtonRow onClick={onLockToggle}>
                                    <FontAwesomeIcon
                                        fixedWidth
                                        icon={backup.isLocked ? faUnlock : faLock}
                                        css={tw`text-xs mr-2`}
                                    />
                                    {backup.isLocked ? 'Unlock' : 'Lock'}
                                </DropdownButtonRow>
                                {!backup.isLocked && canDeleteBackup && (
                                    <DropdownButtonRow danger onClick={() => setModal('delete')}>
                                        <FontAwesomeIcon fixedWidth icon={faTrashAlt} css={tw`text-xs`} />
                                        <span css={tw`ml-2`}>Delete</span>
                                    </DropdownButtonRow>
                                )}
                            </>
                        </Can>
                    </div>
                </DropdownMenu>
            ) : (
                <button
                    onClick={() => setModal('delete')}
                    css={tw`text-gray-200 transition-colors duration-150 hover:text-gray-100 p-2`}
                >
                    <FontAwesomeIcon icon={faTrashAlt} />
                </button>
            )}
        </>
    );
};
