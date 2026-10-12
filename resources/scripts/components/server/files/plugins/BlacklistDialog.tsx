import React, { useEffect, useState } from 'react';
import { Dialog } from '@/components/elements/dialog';
import { Button } from '@/components/elements/button/index';
import Input from '@/components/elements/Input';
import FlashMessageRender from '@/components/FlashMessageRender';
import { useFlashKey } from '@/plugins/useFlash';
import { PluginUpdate, savePluginUpdateRule } from '@/api/server/plugins/pluginUpdates';

const FLASH_KEY = 'plugin-blacklist';

// Mirrors PluginUpdateRule::normalise() on the server: lowercase letters and digits only.
export const normalisePluginName = (name: string): string =>
    name
        .toLowerCase()
        .replace(/\.jar$/, '')
        .replace(/[^a-z0-9]/g, '');

interface Props {
    plugin: PluginUpdate | null;
    onClose: () => void;
    onChanged: () => void;
}

// Confirms a global blacklist entry. The pattern is a prefix, so "chestsorter" covers
// ChestSorter-1.2.jar, chestsorterv1v1v3v.jar and every other version on every server.
export default ({ plugin, onClose, onChanged }: Props) => {
    const [pattern, setPattern] = useState('');
    const [saving, setSaving] = useState(false);
    const { clearFlashes, clearAndAddHttpError } = useFlashKey(FLASH_KEY);

    useEffect(() => {
        if (!plugin) return;

        clearFlashes();
        setPattern(normalisePluginName(plugin.pluginName || plugin.fileName));
    }, [plugin?.fileName]);

    const normalised = normalisePluginName(pattern);

    const save = () => {
        if (!plugin) return;

        clearFlashes();
        setSaving(true);
        savePluginUpdateRule(plugin.pluginName || plugin.fileName, 'blacklist', { pattern: normalised })
            .then(() => {
                onChanged();
                onClose();
            })
            .catch((error) => clearAndAddHttpError(error))
            .finally(() => setSaving(false));
    };

    return (
        <Dialog
            open={!!plugin}
            onClose={onClose}
            preventExternalClose={saving}
            title={'Dodaj do blacklisty'}
            description={'Plugin przestanie być sprawdzany na wszystkich serwerach, w każdej wersji.'}
        >
            <FlashMessageRender byKey={FLASH_KEY} className={'mb-4'} />
            <label className={'block text-sm text-gray-300 mb-1'} htmlFor={'blacklist-pattern'}>
                Wzorzec (nazwa pluginu lub pliku zaczynająca się od)
            </label>
            <div className={'flex items-center gap-2'}>
                <Input id={'blacklist-pattern'} value={pattern} onChange={(e) => setPattern(e.currentTarget.value)} />
                <span className={'text-gray-400 text-lg'}>*</span>
            </div>
            <p className={'mt-2 text-xs text-gray-400'}>
                Zablokuje wszystko, co pasuje do <code className={'text-gray-200'}>{normalised || '…'}*</code> (bez
                wielkości liter, spacji i znaków specjalnych), np. {normalised || 'nazwa'}-1.0.jar,{' '}
                {normalised || 'nazwa'}v2.jar.
            </p>
            <Dialog.Footer>
                <Button.Text onClick={onClose}>Anuluj</Button.Text>
                <Button.Danger disabled={saving || normalised.length < 3} onClick={save}>
                    Blacklistuj {normalised}*
                </Button.Danger>
            </Dialog.Footer>
        </Dialog>
    );
};
