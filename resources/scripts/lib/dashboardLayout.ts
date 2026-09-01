import { Server } from '@/api/server/getServer';
import { v4 as uuidv4 } from 'uuid';

export type DashboardSortMode = 'custom' | 'name_asc' | 'name_desc';

export interface DashboardSection {
    id: string;
    name: string;
    serverUuids: string[];
    trackPlugins?: boolean;
}

export interface DashboardLayout {
    sortMode: DashboardSortMode;
    sections: DashboardSection[];
    unsectionedOrder: string[];
    trackUnsectionedPlugins?: boolean;
}

export type DashboardLayoutScope = 'own' | 'admin';

export interface ScopedDashboardLayouts {
    own: DashboardLayout;
    admin: DashboardLayout;
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
    sortMode: 'name_asc',
    sections: [],
    unsectionedOrder: [],
    trackUnsectionedPlugins: true,
};

export const DEFAULT_SCOPED_DASHBOARD_LAYOUTS: ScopedDashboardLayouts = {
    own: {
        sortMode: DEFAULT_DASHBOARD_LAYOUT.sortMode,
        sections: [],
        unsectionedOrder: [],
        trackUnsectionedPlugins: true,
    },
    admin: {
        sortMode: DEFAULT_DASHBOARD_LAYOUT.sortMode,
        sections: [],
        unsectionedOrder: [],
        trackUnsectionedPlugins: true,
    },
};

export const cloneDashboardLayout = (layout: DashboardLayout): DashboardLayout => ({
    sortMode: layout.sortMode,
    sections: layout.sections.map((section) => ({
        ...section,
        serverUuids: [...section.serverUuids],
    })),
    unsectionedOrder: [...layout.unsectionedOrder],
    trackUnsectionedPlugins: layout.trackUnsectionedPlugins !== false,
});

export const cloneScopedDashboardLayouts = (layouts: ScopedDashboardLayouts): ScopedDashboardLayouts => ({
    own: cloneDashboardLayout(layouts.own),
    admin: cloneDashboardLayout(layouts.admin),
});

const isDashboardLayout = (value: unknown): value is DashboardLayout => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const layout = value as DashboardLayout;

    return (
        typeof layout.sortMode === 'string' && Array.isArray(layout.sections) && Array.isArray(layout.unsectionedOrder)
    );
};

export const normalizeScopedLayouts = (value: unknown): ScopedDashboardLayouts => {
    if (!value || typeof value !== 'object') {
        return cloneScopedDashboardLayouts(DEFAULT_SCOPED_DASHBOARD_LAYOUTS);
    }

    const record = value as Record<string, unknown>;

    if ('own' in record || 'admin' in record) {
        return cloneScopedDashboardLayouts({
            own: isDashboardLayout(record.own)
                ? record.own
                : { ...DEFAULT_DASHBOARD_LAYOUT, sections: [], unsectionedOrder: [] },
            admin: isDashboardLayout(record.admin)
                ? record.admin
                : { ...DEFAULT_DASHBOARD_LAYOUT, sections: [], unsectionedOrder: [] },
        });
    }

    if (isDashboardLayout(value)) {
        return cloneScopedDashboardLayouts({
            own: value,
            admin: { ...DEFAULT_DASHBOARD_LAYOUT, sections: [], unsectionedOrder: [] },
        });
    }

    return cloneScopedDashboardLayouts(DEFAULT_SCOPED_DASHBOARD_LAYOUTS);
};

export interface OrganizedDashboard {
    sections: { section: DashboardSection; servers: Server[] }[];
    unsectioned: Server[];
}

const sortByName = (servers: Server[], direction: 'asc' | 'desc'): Server[] => {
    return [...servers].sort((a, b) => {
        const result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

        return direction === 'asc' ? result : -result;
    });
};

const sortByCustomOrder = (servers: Server[], order: string[]): Server[] => {
    const orderMap = new Map(order.map((uuid, index) => [uuid, index]));

    return [...servers].sort((a, b) => {
        const aIndex = orderMap.get(a.uuid) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = orderMap.get(b.uuid) ?? Number.MAX_SAFE_INTEGER;

        if (aIndex === bIndex) {
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }

        return aIndex - bIndex;
    });
};

export const syncLayoutWithServers = (
    layout: DashboardLayout,
    servers: Server[],
    options?: { pruneEmptySections?: boolean }
): DashboardLayout => {
    const available = new Set(servers.map((server) => server.uuid));
    const referenced = new Set<string>();

    let sections = layout.sections.map((section) => {
        const serverUuids = section.serverUuids.filter((uuid) => {
            if (!available.has(uuid) || referenced.has(uuid)) {
                return false;
            }

            referenced.add(uuid);

            return true;
        });

        return { ...section, serverUuids };
    });

    if (options?.pruneEmptySections) {
        sections = sections.filter((section) => section.serverUuids.length > 0);
    }

    const unsectionedOrder = layout.unsectionedOrder.filter((uuid) => {
        if (!available.has(uuid) || referenced.has(uuid)) {
            return false;
        }

        referenced.add(uuid);

        return true;
    });

    const missing = servers.map((server) => server.uuid).filter((uuid) => !referenced.has(uuid));

    return {
        ...layout,
        sections,
        unsectionedOrder: [...unsectionedOrder, ...missing],
    };
};

export const organizeDashboardServers = (
    servers: Server[],
    layout: DashboardLayout,
    options?: { includeEmptySections?: boolean }
): OrganizedDashboard => {
    const synced = syncLayoutWithServers(layout, servers);
    const serverMap = new Map(servers.map((server) => [server.uuid, server]));

    const sections = synced.sections
        .map((section) => {
            let sectionServers = section.serverUuids
                .map((uuid) => serverMap.get(uuid))
                .filter((server): server is Server => !!server);

            if (synced.sortMode === 'name_asc') {
                sectionServers = sortByName(sectionServers, 'asc');
            } else if (synced.sortMode === 'name_desc') {
                sectionServers = sortByName(sectionServers, 'desc');
            }

            return { section, servers: sectionServers };
        })
        .filter(({ servers: sectionServers }) => options?.includeEmptySections || sectionServers.length > 0);

    const sectioned = new Set(synced.sections.flatMap((section) => section.serverUuids));
    let unsectioned = servers.filter((server) => !sectioned.has(server.uuid));

    if (synced.sortMode === 'custom') {
        unsectioned = sortByCustomOrder(unsectioned, synced.unsectionedOrder);
    } else if (synced.sortMode === 'name_asc') {
        unsectioned = sortByName(unsectioned, 'asc');
    } else {
        unsectioned = sortByName(unsectioned, 'desc');
    }

    return { sections, unsectioned };
};

export const createDashboardSection = (name: string): DashboardSection => ({
    id: uuidv4(),
    name,
    serverUuids: [],
});

export const removeServerFromLayout = (layout: DashboardLayout, serverUuid: string): DashboardLayout => ({
    ...layout,
    sections: layout.sections.map((section) => ({
        ...section,
        serverUuids: section.serverUuids.filter((uuid) => uuid !== serverUuid),
    })),
    unsectionedOrder: layout.unsectionedOrder.filter((uuid) => uuid !== serverUuid),
});

export const moveServerInLayout = (
    layout: DashboardLayout,
    serverUuid: string,
    targetSectionId: string | null,
    targetIndex?: number
): DashboardLayout => {
    const without = removeServerFromLayout(layout, serverUuid);

    if (targetSectionId) {
        return {
            ...without,
            sections: without.sections.map((section) => {
                if (section.id !== targetSectionId) {
                    return section;
                }

                const serverUuids = [...section.serverUuids];
                const index =
                    typeof targetIndex === 'number' ? Math.min(targetIndex, serverUuids.length) : serverUuids.length;
                serverUuids.splice(index, 0, serverUuid);

                return { ...section, serverUuids };
            }),
        };
    }

    const unsectionedOrder = [...without.unsectionedOrder];
    const index =
        typeof targetIndex === 'number' ? Math.min(targetIndex, unsectionedOrder.length) : unsectionedOrder.length;
    unsectionedOrder.splice(index, 0, serverUuid);

    return {
        ...without,
        unsectionedOrder,
    };
};

export const removeDashboardSection = (layout: DashboardLayout, sectionId: string): DashboardLayout => {
    const section = layout.sections.find((entry) => entry.id === sectionId);
    if (!section) {
        return layout;
    }

    return {
        ...layout,
        sections: layout.sections.filter((entry) => entry.id !== sectionId),
        unsectionedOrder: [...layout.unsectionedOrder, ...section.serverUuids],
    };
};

export const renameDashboardSection = (layout: DashboardLayout, sectionId: string, name: string): DashboardLayout => ({
    ...layout,
    sections: layout.sections.map((section) => (section.id === sectionId ? { ...section, name } : section)),
});

export const reorderSectionServers = (
    layout: DashboardLayout,
    sectionId: string,
    serverUuids: string[]
): DashboardLayout => ({
    ...layout,
    sections: layout.sections.map((section) => (section.id === sectionId ? { ...section, serverUuids } : section)),
});

export const reorderUnsectionedServers = (layout: DashboardLayout, serverUuids: string[]): DashboardLayout => ({
    ...layout,
    unsectionedOrder: serverUuids,
});

export const setSectionPluginTracking = (
    layout: DashboardLayout,
    sectionId: string,
    enabled: boolean
): DashboardLayout => ({
    ...layout,
    sections: layout.sections.map((section) =>
        section.id === sectionId ? { ...section, trackPlugins: enabled } : section
    ),
});

export const setUnsectionedPluginTracking = (layout: DashboardLayout, enabled: boolean): DashboardLayout => ({
    ...layout,
    trackUnsectionedPlugins: enabled,
});

/*
 * Returns the uuids of servers excluded from plugin duplicate tracking: servers in
 * sections with tracking switched off, or unsectioned servers when the unsectioned
 * group has tracking switched off.
 */
export const getPluginTrackingExcludedUuids = (servers: Server[], layout: DashboardLayout): Set<string> => {
    const excluded = new Set<string>();
    const sectioned = new Set<string>();

    for (const section of layout.sections) {
        for (const uuid of section.serverUuids) {
            sectioned.add(uuid);

            if (section.trackPlugins === false) {
                excluded.add(uuid);
            }
        }
    }

    if (layout.trackUnsectionedPlugins === false) {
        for (const server of servers) {
            if (!sectioned.has(server.uuid)) {
                excluded.add(server.uuid);
            }
        }
    }

    return excluded;
};
