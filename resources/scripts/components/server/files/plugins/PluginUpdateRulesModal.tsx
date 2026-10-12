import React, { useEffect, useState } from 'react';
import { Dialog } from '@/components/elements/dialog';
import { Button } from '@/components/elements/button/index';
import Spinner from '@/components/elements/Spinner';
import FlashMessageRender from '@/components/FlashMessageRender';
import { useFlashKey } from '@/plugins/useFlash';
import { deletePluginUpdateRule, getPluginUpdateRules, PluginUpdateRule } from '@/api/server/plugins/pluginUpdates';

const FLASH_KEY = 'plugin-update-rules';

// Lists the panel-wide blacklist and manual project links so a root admin can remove them.
export default ({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) => {
    const [rules, setRules] = useState<PluginUpdateRule[] | null>(null);
    const [busy, setBusy] = useState<number | null>(null);
    const { clearFlashes, clearAndAddHttpError } = useFlashKey(FLASH_KEY);

    const load = () =>
        getPluginUpdateRules()
            .then(setRules)
            .catch((error) => clearAndAddHttpError(error));

    useEffect(() => {
        if (!open) return;

        clearFlashes();
        setRules(null);
        load();
    }, [open]);

    const remove = (rule: PluginUpdateRule) => {
        clearFlashes();
        setBusy(rule.id);
        deletePluginUpdateRule(rule.id)
            .then(() => load())
            .then(() => onChanged())
            .catch((error) => clearAndAddHttpError(error))
            .finally(() => setBusy(null));
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={'Plugin update rules'}
            description={"These apply to every server. Add new rules from a plugin's own window."}
        >
            <FlashMessageRender byKey={FLASH_KEY} className={'mb-4'} />
            {!rules ? (
                <Spinner centered />
            ) : !rules.length ? (
                <p className={'text-sm text-gray-400 text-center py-4'}>No rules.</p>
            ) : (
                <div className={'max-h-[60vh] overflow-y-auto'}>
                    {rules.map((rule) => (
                        <div
                            key={rule.id}
                            className={'flex items-center gap-3 py-2 border-b border-gray-600 last:border-0 text-sm'}
                        >
                            <span
                                className={`flex-none rounded px-2 py-0.5 text-xs ${
                                    rule.type === 'blacklist' ? 'bg-red-600 text-red-50' : 'bg-blue-600 text-blue-50'
                                }`}
                            >
                                {rule.type === 'blacklist' ? 'blacklist' : 'link'}
                            </span>
                            <div className={'flex-1 min-w-0'}>
                                <p className={'text-gray-100 truncate'}>
                                    {rule.type === 'blacklist' ? (
                                        <>
                                            <code>{rule.pattern}*</code>
                                            <span className={'text-xs text-gray-400'}> ({rule.pluginName})</span>
                                        </>
                                    ) : (
                                        rule.pluginName
                                    )}
                                </p>
                                {rule.projectUrl && (
                                    <a
                                        href={rule.projectUrl}
                                        target={'_blank'}
                                        rel={'noopener noreferrer'}
                                        className={'block text-xs text-cyan-400 truncate hover:underline'}
                                    >
                                        {rule.projectUrl}
                                    </a>
                                )}
                            </div>
                            <Button.Text
                                size={Button.Sizes.Small}
                                disabled={busy === rule.id}
                                onClick={() => remove(rule)}
                            >
                                Remove
                            </Button.Text>
                        </div>
                    ))}
                </div>
            )}
            <Dialog.Footer>
                <Button.Text onClick={onClose}>Close</Button.Text>
            </Dialog.Footer>
        </Dialog>
    );
};
