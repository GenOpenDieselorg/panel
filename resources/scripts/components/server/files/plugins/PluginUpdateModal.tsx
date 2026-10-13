import React, { useEffect, useState } from 'react';
import { Dialog } from '@/components/elements/dialog';
import { Button } from '@/components/elements/button/index';
import Input from '@/components/elements/Input';
import FlashMessageRender from '@/components/FlashMessageRender';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import { ServerContext } from '@/state/server';
import { useStoreState } from '@/state/hooks';
import { usePermissions } from '@/plugins/usePermissions';
import { useFlashKey } from '@/plugins/useFlash';
import {
    deletePluginUpdateRule,
    PluginUpdate,
    PluginUpdateStatus,
    savePluginUpdateRule,
    updatePlugin,
} from '@/api/server/plugins/pluginUpdates';

import { usePluginUpdates } from '@/components/server/files/plugins/PluginUpdatesContext';

const FLASH_KEY = 'plugin-updates';

export const sourceLabel = (source: PluginUpdate['source']): string =>
    source === 'modrinth' ? 'Modrinth' : source === 'spigot' ? 'SpigotMC' : '—';

const STATUS_LABELS: Record<PluginUpdateStatus, string> = {
    pending: 'Waiting to be checked.',
    update_available: 'A newer version is available.',
    up_to_date: 'You have the latest version.',
    not_found: 'This plugin (with this version) was not found on Modrinth or SpigotMC.',
    not_downloadable: 'Plugin found, but it cannot be downloaded automatically (premium or external link).',
    ignored: 'This plugin is on the global blacklist and is not checked.',
    custom: 'Custom build by genallthebest: never updated automatically.',
    unreadable: 'Could not read plugin.yml from this file.',
    error: 'The check failed.',
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className={'flex py-1.5 border-b border-gray-600 last:border-0 text-sm'}>
        <span className={'w-36 flex-none text-gray-400'}>{label}</span>
        <span className={'flex-1 min-w-0 break-words text-gray-100'}>{children}</span>
    </div>
);

interface Props {
    plugin: PluginUpdate | null;
    onClose: () => void;
    onChanged: () => void;
}

export default ({ plugin, onClose, onChanged }: Props) => {
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const { blacklist } = usePluginUpdates();
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const [canCreate, canDelete] = usePermissions(['file.create', 'file.delete']);
    const { clearFlashes, clearAndAddHttpError } = useFlashKey(FLASH_KEY);

    const [busy, setBusy] = useState<string | null>(null);
    const [linkUrl, setLinkUrl] = useState('');
    const [done, setDone] = useState<PluginUpdate | null | undefined>(undefined);

    useEffect(() => {
        clearFlashes();
        setLinkUrl(plugin?.rule?.type === 'link' ? plugin.rule.projectUrl || '' : '');
        setDone(undefined);
    }, [plugin?.fileName]);

    if (!plugin) {
        return <Dialog open={false} onClose={onClose} />;
    }

    const run = (label: string, action: () => Promise<unknown>) => {
        clearFlashes();
        setBusy(label);
        action()
            .then(() => onChanged())
            .catch((error) => clearAndAddHttpError(error))
            .finally(() => setBusy(null));
    };

    const onUpdate = () =>
        run('Downloading and replacing the file...', () =>
            updatePlugin(uuid, plugin.fileName).then((updated) => setDone(updated))
        );

    const onSaveLink = () =>
        run('Looking up versions in the new project...', () =>
            savePluginUpdateRule(plugin.pluginName || '', 'link', { url: linkUrl.trim() })
        );

    const onBlacklist = () => {
        onClose();
        blacklist(plugin.fileName);
    };

    const onRemoveRule = () => run('Saving...', () => deletePluginUpdateRule(plugin.rule!.id));

    return (
        <Dialog
            open
            onClose={onClose}
            preventExternalClose={!!busy}
            title={plugin.pluginName || plugin.fileName}
            description={done === undefined ? STATUS_LABELS[plugin.status] : undefined}
        >
            <SpinnerOverlay visible={!!busy} size={'large'}>
                {busy}
            </SpinnerOverlay>
            <FlashMessageRender byKey={FLASH_KEY} className={'mb-4'} />

            {done !== undefined ? (
                <div className={'rounded bg-green-600/20 border border-green-600 p-4 text-sm text-green-50'}>
                    <p>
                        Updated <strong>{plugin.pluginName}</strong> to version{' '}
                        <strong>{done?.pluginVersion || plugin.latestVersion}</strong>
                        {done && <> ({done.fileName})</>}.
                    </p>
                    <p className={'mt-2'}>
                        Restart the server to load the new version. The old file was moved to{' '}
                        <code>plugins/.update-backups/</code>.
                    </p>
                </div>
            ) : (
                <>
                    <div className={'rounded bg-gray-700 px-4 py-2'}>
                        <Row label={'File'}>{plugin.fileName}</Row>
                        <Row label={'Installed'}>{plugin.pluginVersion || '—'}</Row>
                        {plugin.latestVersion && <Row label={'Latest'}>{plugin.latestVersion}</Row>}
                        {plugin.projectUrl && (
                            <Row label={'Source'}>
                                <a
                                    href={plugin.projectUrl}
                                    target={'_blank'}
                                    rel={'noopener noreferrer'}
                                    className={'text-cyan-400 hover:underline'}
                                >
                                    {sourceLabel(plugin.source)}: {plugin.projectTitle || plugin.projectUrl}
                                </a>
                                {plugin.rule?.type === 'link' && (
                                    <span className={'ml-2 text-xs text-yellow-400'}>(link set manually)</span>
                                )}
                            </Row>
                        )}
                        {plugin.latestGameVersions.length > 0 && (
                            <Row label={'MC versions'}>
                                {plugin.latestGameVersions.length > 6
                                    ? `${plugin.latestGameVersions[0]} … ${
                                          plugin.latestGameVersions[plugin.latestGameVersions.length - 1]
                                      }`
                                    : plugin.latestGameVersions.join(', ')}
                            </Row>
                        )}
                        {plugin.pluginAuthors.length > 0 && (
                            <Row label={'Author (plugin.yml)'}>{plugin.pluginAuthors.join(', ')}</Row>
                        )}
                        {plugin.error && <Row label={'Error'}>{plugin.error}</Row>}
                    </div>

                    {plugin.status === 'update_available' && (
                        <p className={'mt-3 text-xs text-gray-400'}>
                            Make sure the source really is the same plugin. The new file is verified (its plugin.yml
                            name) before the swap, and the old one is moved to <code>plugins/.update-backups/</code>.
                            The change takes effect after a server restart.
                        </p>
                    )}

                    {rootAdmin && plugin.pluginName && (
                        <div className={'mt-5 border-t border-gray-600 pt-4'}>
                            <p className={'text-xs uppercase tracking-wide text-gray-400 mb-2'}>
                                Admin: global rules for “{plugin.pluginName}”
                            </p>
                            <label className={'block text-sm text-gray-300 mb-1'} htmlFor={'plugin-link'}>
                                Wrong plugin? Paste the correct link (Modrinth or SpigotMC)
                            </label>
                            <div className={'flex gap-2'}>
                                <Input
                                    id={'plugin-link'}
                                    value={linkUrl}
                                    placeholder={'https://www.spigotmc.org/resources/name.12345/'}
                                    onChange={(e) => setLinkUrl(e.currentTarget.value)}
                                />
                                <Button
                                    variant={Button.Variants.Secondary}
                                    disabled={!linkUrl.trim()}
                                    onClick={onSaveLink}
                                >
                                    Save link
                                </Button>
                            </div>
                            <div className={'flex flex-wrap gap-2 mt-3'}>
                                {plugin.rule ? (
                                    <Button.Text onClick={onRemoveRule}>
                                        {plugin.rule.type === 'blacklist'
                                            ? `Remove from blacklist (${plugin.rule.pattern}*)`
                                            : 'Remove manual link'}
                                    </Button.Text>
                                ) : null}
                                {plugin.rule?.type !== 'blacklist' && (
                                    <Button.Danger variant={Button.Variants.Secondary} onClick={onBlacklist}>
                                        Add to blacklist
                                    </Button.Danger>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            <Dialog.Footer>
                <Button.Text onClick={onClose}>Close</Button.Text>
                {done === undefined && plugin.status === 'update_available' && canCreate && canDelete && (
                    <Button onClick={onUpdate} disabled={!!busy}>
                        Update to {plugin.latestVersion}
                    </Button>
                )}
            </Dialog.Footer>
        </Dialog>
    );
};
