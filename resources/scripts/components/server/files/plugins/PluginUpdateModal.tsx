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
    pending: 'Czeka na sprawdzenie.',
    update_available: 'Dostępna jest nowsza wersja.',
    up_to_date: 'Masz najnowszą wersję.',
    not_found: 'Nie znaleziono tego pluginu (z tą wersją) na Modrinth ani SpigotMC.',
    not_downloadable: 'Plugin znaleziony, ale nie da się go pobrać automatycznie (premium lub link zewnętrzny).',
    ignored: 'Plugin jest na globalnej blackliście — nie jest sprawdzany.',
    unreadable: 'Nie udało się odczytać plugin.yml z tego pliku.',
    error: 'Sprawdzanie zakończyło się błędem.',
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
        run('Pobieranie i podmiana pliku...', () =>
            updatePlugin(uuid, plugin.fileName).then((updated) => setDone(updated))
        );

    const onSaveLink = () =>
        run('Szukanie wersji w nowym projekcie...', () =>
            savePluginUpdateRule(plugin.pluginName || '', 'link', { url: linkUrl.trim() })
        );

    const onBlacklist = () => {
        onClose();
        blacklist(plugin.fileName);
    };

    const onRemoveRule = () => run('Zapisywanie...', () => deletePluginUpdateRule(plugin.rule!.id));

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
                        Zaktualizowano <strong>{plugin.pluginName}</strong> do wersji{' '}
                        <strong>{done?.pluginVersion || plugin.latestVersion}</strong>
                        {done && <> ({done.fileName})</>}.
                    </p>
                    <p className={'mt-2'}>
                        Zrestartuj serwer, żeby załadować nową wersję. Stary plik został przeniesiony do{' '}
                        <code>plugins/.update-backups/</code>.
                    </p>
                </div>
            ) : (
                <>
                    <div className={'rounded bg-gray-700 px-4 py-2'}>
                        <Row label={'Plik'}>{plugin.fileName}</Row>
                        <Row label={'Zainstalowana'}>{plugin.pluginVersion || '—'}</Row>
                        {plugin.latestVersion && <Row label={'Najnowsza'}>{plugin.latestVersion}</Row>}
                        {plugin.projectUrl && (
                            <Row label={'Źródło'}>
                                <a
                                    href={plugin.projectUrl}
                                    target={'_blank'}
                                    rel={'noopener noreferrer'}
                                    className={'text-cyan-400 hover:underline'}
                                >
                                    {sourceLabel(plugin.source)}: {plugin.projectTitle || plugin.projectUrl}
                                </a>
                                {plugin.rule?.type === 'link' && (
                                    <span className={'ml-2 text-xs text-yellow-400'}>(link ustawiony ręcznie)</span>
                                )}
                            </Row>
                        )}
                        {plugin.latestGameVersions.length > 0 && (
                            <Row label={'Wersje MC'}>
                                {plugin.latestGameVersions.length > 6
                                    ? `${plugin.latestGameVersions[0]} … ${
                                          plugin.latestGameVersions[plugin.latestGameVersions.length - 1]
                                      }`
                                    : plugin.latestGameVersions.join(', ')}
                            </Row>
                        )}
                        {plugin.pluginAuthors.length > 0 && (
                            <Row label={'Autor (plugin.yml)'}>{plugin.pluginAuthors.join(', ')}</Row>
                        )}
                        {plugin.error && <Row label={'Błąd'}>{plugin.error}</Row>}
                    </div>

                    {plugin.status === 'update_available' && (
                        <p className={'mt-3 text-xs text-gray-400'}>
                            Sprawdź, czy źródło to na pewno ten sam plugin. Nowy plik zostanie zweryfikowany (nazwa z
                            plugin.yml) przed podmianą, a stary trafi do <code>plugins/.update-backups/</code>. Zmiana
                            zadziała po restarcie serwera.
                        </p>
                    )}

                    {rootAdmin && plugin.pluginName && (
                        <div className={'mt-5 border-t border-gray-600 pt-4'}>
                            <p className={'text-xs uppercase tracking-wide text-gray-400 mb-2'}>
                                Administrator — reguły globalne dla „{plugin.pluginName}”
                            </p>
                            <label className={'block text-sm text-gray-300 mb-1'} htmlFor={'plugin-link'}>
                                Zły plugin? Wklej poprawny link (Modrinth lub SpigotMC)
                            </label>
                            <div className={'flex gap-2'}>
                                <Input
                                    id={'plugin-link'}
                                    value={linkUrl}
                                    placeholder={'https://www.spigotmc.org/resources/nazwa.12345/'}
                                    onChange={(e) => setLinkUrl(e.currentTarget.value)}
                                />
                                <Button
                                    variant={Button.Variants.Secondary}
                                    disabled={!linkUrl.trim()}
                                    onClick={onSaveLink}
                                >
                                    Zapisz link
                                </Button>
                            </div>
                            <div className={'flex flex-wrap gap-2 mt-3'}>
                                {plugin.rule ? (
                                    <Button.Text onClick={onRemoveRule}>
                                        {plugin.rule.type === 'blacklist'
                                            ? `Usuń z blacklisty (${plugin.rule.pattern}*)`
                                            : 'Usuń ręczny link'}
                                    </Button.Text>
                                ) : null}
                                {plugin.rule?.type !== 'blacklist' && (
                                    <Button.Danger variant={Button.Variants.Secondary} onClick={onBlacklist}>
                                        Dodaj do blacklisty
                                    </Button.Danger>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            <Dialog.Footer>
                <Button.Text onClick={onClose}>Zamknij</Button.Text>
                {done === undefined && plugin.status === 'update_available' && canCreate && canDelete && (
                    <Button onClick={onUpdate} disabled={!!busy}>
                        Aktualizuj do {plugin.latestVersion}
                    </Button>
                )}
            </Dialog.Footer>
        </Dialog>
    );
};
