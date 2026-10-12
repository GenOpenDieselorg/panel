import http from '@/api/http';

export type PluginSource = 'modrinth' | 'spigot';

export interface PluginStoreResult {
    source: PluginSource;
    project: string;
    title: string;
    description: string;
    author: string | null;
    downloads: number;
    iconUrl: string | null;
    url: string;
    // null when the source cannot tell whether the plugin supports the requested game version.
    compatible: boolean | null;
}

export interface PluginStoreVersion {
    id: string;
    name: string;
    type: string;
    publishedAt: Date | null;
    gameVersions: string[];
    compatible: boolean | null;
}

export interface InstalledPlugin {
    fileName: string;
    pluginName: string;
    pluginVersion: string;
}

export const getServerGameVersion = async (uuid: string): Promise<string | null> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/plugin-store/game-version`);

    return data.game_version || null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const searchPlugins = async (
    uuid: string,
    source: PluginSource,
    query: string,
    gameVersion: string
): Promise<PluginStoreResult[]> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/plugin-store/search`, {
        params: { source, query, game_version: gameVersion || null },
        timeout: 60000,
    });

    return (data.results || []).map((r: any) => ({
        source: r.source,
        project: r.project,
        title: r.title,
        description: r.description,
        author: r.author,
        downloads: r.downloads,
        iconUrl: r.icon_url,
        url: r.url,
        compatible: r.compatible,
    }));
};

export const getPluginVersions = async (
    uuid: string,
    source: PluginSource,
    project: string,
    gameVersion: string
): Promise<PluginStoreVersion[]> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/plugin-store/versions`, {
        params: { source, project, game_version: gameVersion || null },
        timeout: 60000,
    });

    return (data.versions || []).map((v: any) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        publishedAt: v.published_at ? new Date(v.published_at) : null,
        gameVersions: v.game_versions || [],
        compatible: v.compatible,
    }));
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const installPlugin = async (
    uuid: string,
    source: PluginSource,
    project: string,
    version: string | null
): Promise<InstalledPlugin> => {
    const { data } = await http.post(
        `/api/client/servers/${uuid}/plugin-store/install`,
        { source, project, version },
        { timeout: 300000 }
    );

    return { fileName: data.file_name, pluginName: data.plugin_name, pluginVersion: data.plugin_version };
};
