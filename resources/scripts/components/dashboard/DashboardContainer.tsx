import React, { useEffect, useRef, useState } from 'react';
import getAllServers from '@/api/getAllServers';
import Spinner from '@/components/elements/Spinner';
import PageContentBlock from '@/components/elements/PageContentBlock';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from 'easy-peasy';
import { usePersistedState } from '@/plugins/usePersistedState';
import Switch from '@/components/elements/Switch';
import tw from 'twin.macro';
import useSWR from 'swr';
import { Server } from '@/api/server/getServer';
import DashboardToolbar from '@/components/dashboard/DashboardToolbar';
import DashboardServerList from '@/components/dashboard/DashboardServerList';
import useDashboardLayout from '@/components/dashboard/useDashboardLayout';
import {
    createDashboardSection,
    DashboardSortMode,
    getPluginTrackingExcludedUuids,
    syncLayoutWithServers,
} from '@/lib/dashboardLayout';
import PluginConflictScrollMarkers from '@/components/dashboard/PluginConflictScrollMarkers';
import loadDirectory from '@/api/server/files/loadDirectory';
import { findPluginVersionConflicts } from '@/lib/pluginVersionConflicts';
import { Alert } from '@/components/elements/alert';
import Button from '@/components/elements/Button';

const PLUGIN_CONFLICT_CHECK_CONCURRENCY = 3;

const serverHasPluginVersionConflict = async (server: Server): Promise<boolean> => {
    try {
        const files = await loadDirectory(server.uuid, '/plugins');
        return findPluginVersionConflicts(files).length > 0;
    } catch {
        return false;
    }
};

export default () => {
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const uuid = useStoreState((state) => state.user.data!.uuid);
    const [showOnlyAdmin, setShowOnlyAdmin] = usePersistedState(`${uuid}:show_all_servers`, false);
    const [isOrganizing, setIsOrganizing] = useState(false);
    const [pluginVersionConflictServers, setPluginVersionConflictServers] = useState<Server[]>([]);
    const layoutScope = showOnlyAdmin && rootAdmin ? 'admin' : 'own';
    const { layout, setLayout, flushLayout, isLoading: isLayoutLoading } = useDashboardLayout(layoutScope);
    const prevLayoutScopeRef = useRef(layoutScope);

    useEffect(() => {
        if (prevLayoutScopeRef.current !== layoutScope) {
            setIsOrganizing(false);
            prevLayoutScopeRef.current = layoutScope;
        }
    }, [layoutScope]);

    const { data: servers, error } = useSWR<Server[]>(['/api/client/servers/all', showOnlyAdmin && rootAdmin], () =>
        getAllServers({ type: showOnlyAdmin && rootAdmin ? 'admin' : undefined })
    );

    useEffect(() => {
        if (error) clearAndAddHttpError({ key: 'dashboard', error });
        if (!error) clearFlashes('dashboard');
    }, [error]);

    // Servers excluded from plugin tracking via the organizer toggles. The joined-string
    // key keeps the scan effect from re-running on every drag while organizing.
    const pluginTrackingExcludedUuids = getPluginTrackingExcludedUuids(servers ?? [], layout);
    const pluginTrackingExcludedKey = [...pluginTrackingExcludedUuids].sort().join(',');

    useEffect(() => {
        let cancelled = false;

        const trackedServers = (servers ?? []).filter((server) => !pluginTrackingExcludedUuids.has(server.uuid));

        if (trackedServers.length === 0) {
            setPluginVersionConflictServers([]);

            return;
        }

        let nextServerIndex = 0;
        const conflicts: Server[] = [];

        const checkNextServer = async (): Promise<void> => {
            while (!cancelled && nextServerIndex < trackedServers.length) {
                const server = trackedServers[nextServerIndex];
                nextServerIndex += 1;

                if (await serverHasPluginVersionConflict(server)) {
                    conflicts.push(server);
                }
            }
        };

        setPluginVersionConflictServers([]);

        Promise.all(
            Array.from({ length: Math.min(PLUGIN_CONFLICT_CHECK_CONCURRENCY, trackedServers.length) }, () =>
                checkNextServer()
            )
        ).then(() => {
            if (!cancelled) {
                setPluginVersionConflictServers(conflicts);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [servers, pluginTrackingExcludedKey]);

    const scrollToPluginVersionConflictServer = (serverUuid = pluginVersionConflictServers[0]?.uuid) => {
        if (!serverUuid) {
            return;
        }

        document
            .getElementById(`dashboard-server-${serverUuid}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const isLoading = !servers || isLayoutLoading;
    const pluginVersionConflictServerUuids = pluginVersionConflictServers.map((server) => server.uuid);
    const pluginVersionConflictNames = pluginVersionConflictServers.map((server) => server.name);
    const pluginVersionConflictLabel =
        pluginVersionConflictNames.length <= 3
            ? pluginVersionConflictNames.join(', ')
            : `${pluginVersionConflictNames.slice(0, 3).join(', ')} +${pluginVersionConflictNames.length - 3} more`;

    return (
        <PageContentBlock title={'Dashboard'} showFlashKey={'dashboard'}>
            {rootAdmin && (
                <div css={tw`mb-2 flex justify-end items-center`}>
                    <p css={tw`uppercase text-xs text-neutral-400 mr-2`}>
                        {showOnlyAdmin ? "Showing others' servers" : 'Showing your servers'}
                    </p>
                    <Switch
                        name={'show_all_servers'}
                        defaultChecked={showOnlyAdmin}
                        onChange={() => setShowOnlyAdmin((s) => !s)}
                    />
                </div>
            )}

            {!isLoading && servers && pluginVersionConflictServers.length > 0 && (
                <PluginConflictScrollMarkers
                    servers={servers}
                    conflictServerUuids={pluginVersionConflictServerUuids}
                    recomputeKey={layout}
                    onSelect={scrollToPluginVersionConflictServer}
                />
            )}

            {pluginVersionConflictServers.length > 0 && (
                <Alert type={'danger'} className={'mb-4'}>
                    <span className={'text-sm'}>
                        Possible duplicate plugin versions detected on: {pluginVersionConflictLabel}.
                    </span>
                    <Button
                        type={'button'}
                        size={'xsmall'}
                        color={'red'}
                        isSecondary
                        css={tw`ml-auto`}
                        onClick={() => scrollToPluginVersionConflictServer()}
                    >
                        Show
                    </Button>
                </Alert>
            )}

            {!isLoading && servers && servers.length > 0 && (
                <DashboardToolbar
                    sortMode={layout.sortMode}
                    isOrganizing={isOrganizing}
                    onSortModeChange={(sortMode: DashboardSortMode) =>
                        setLayout((current) => ({ ...current, sortMode }))
                    }
                    onToggleOrganizing={() => {
                        setIsOrganizing((current) => {
                            if (current && servers) {
                                const syncedLayout = syncLayoutWithServers(layout, servers, {
                                    pruneEmptySections: true,
                                });
                                void flushLayout(syncedLayout, true).then((saved) => {
                                    if (!saved) {
                                        clearAndAddHttpError({
                                            key: 'dashboard',
                                            error: new Error('Failed to save the server layout.'),
                                        });
                                    } else {
                                        clearFlashes('dashboard');
                                    }
                                });
                            }

                            return !current;
                        });
                    }}
                    onCreateSection={(name) => {
                        setLayout((current) => ({
                            ...current,
                            sections: [...current.sections, createDashboardSection(name)],
                        }));

                        // A fresh section holds no servers yet, and empty sections are only
                        // rendered while organizing — switch into it so the section is visible.
                        setIsOrganizing(true);
                    }}
                />
            )}

            {isLoading ? (
                <Spinner centered size={'large'} />
            ) : servers && servers.length > 0 ? (
                <DashboardServerList
                    key={layoutScope}
                    servers={servers}
                    layout={layout}
                    isOrganizing={isOrganizing}
                    pluginVersionConflictServerUuids={pluginVersionConflictServerUuids}
                    onLayoutChange={setLayout}
                />
            ) : (
                <p css={tw`text-center text-sm text-neutral-400`}>
                    {showOnlyAdmin
                        ? 'There are no other servers to display.'
                        : 'There are no servers associated with your account.'}
                </p>
            )}
        </PageContentBlock>
    );
};
