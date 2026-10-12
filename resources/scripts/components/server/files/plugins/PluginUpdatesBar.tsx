import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import pl from 'date-fns/locale/pl';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowCircleUp, faSyncAlt } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@/components/elements/button/index';
import Can from '@/components/elements/Can';
import { useStoreState } from '@/state/hooks';
import { ServerContext } from '@/state/server';
import { useFlashKey } from '@/plugins/useFlash';
import { checkPluginUpdates, PluginUpdateList } from '@/api/server/plugins/pluginUpdates';
import PluginUpdateRulesModal from '@/components/server/files/plugins/PluginUpdateRulesModal';

interface Props {
    data: PluginUpdateList | undefined;
    onChanged: () => void;
    onShowFirst: () => void;
}

// Summary strip above the /plugins listing: how many updates the last check found and when it ran.
export default ({ data, onChanged, onShowFirst }: Props) => {
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const { clearAndAddHttpError } = useFlashKey('files');
    const [rulesOpen, setRulesOpen] = useState(false);

    const updates = data?.plugins.filter((plugin) => plugin.status === 'update_available').length ?? 0;
    const checking = data?.checking ?? false;

    const onCheck = () => {
        checkPluginUpdates(uuid)
            .then(() => onChanged())
            .catch((error) => clearAndAddHttpError(error));
    };

    return (
        <div className={'flex flex-wrap items-center gap-3 mb-3 px-4 py-2 rounded bg-gray-700 text-sm'}>
            {updates > 0 ? (
                <button
                    type={'button'}
                    onClick={onShowFirst}
                    className={'flex items-center gap-2 text-green-400 hover:text-green-300'}
                >
                    <FontAwesomeIcon icon={faArrowCircleUp} />
                    {updates === 1 ? '1 plugin ma aktualizację' : `${updates} pluginów ma aktualizacje`}
                </button>
            ) : (
                <span className={'text-gray-300'}>
                    {data?.lastCheckedAt
                        ? 'Wszystkie rozpoznane pluginy są aktualne.'
                        : 'Pluginy nie były jeszcze sprawdzane.'}
                </span>
            )}
            <span className={'text-xs text-gray-400'}>
                {checking
                    ? 'Sprawdzanie w toku…'
                    : data?.lastCheckedAt
                    ? `Sprawdzono ${formatDistanceToNow(data.lastCheckedAt, { addSuffix: true, locale: pl })}`
                    : 'Sprawdzanie odbywa się automatycznie raz dziennie.'}
            </span>
            <div className={'flex gap-2 ml-auto'}>
                {rootAdmin && (
                    <Button.Text size={Button.Sizes.Small} onClick={() => setRulesOpen(true)}>
                        Blacklista i linki
                    </Button.Text>
                )}
                <Can action={'file.create'}>
                    <Button
                        size={Button.Sizes.Small}
                        variant={Button.Variants.Secondary}
                        disabled={checking}
                        onClick={onCheck}
                    >
                        <FontAwesomeIcon icon={faSyncAlt} spin={checking} className={'mr-2'} />
                        Sprawdź teraz
                    </Button>
                </Can>
            </div>
            {rootAdmin && (
                <PluginUpdateRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} onChanged={onChanged} />
            )}
        </div>
    );
};
