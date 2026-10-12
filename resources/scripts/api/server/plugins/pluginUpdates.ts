import http from '@/api/http';

export type PluginUpdateStatus =
    | 'pending'
    | 'update_available'
    | 'up_to_date'
    | 'not_found'
    | 'not_downloadable'
    | 'ignored'
    | 'unreadable'
    | 'error';

export interface PluginUpdate {
    fileName: string;
    pluginName: string | null;
    pluginVersion: string | null;
    pluginAuthors: string[];
    status: PluginUpdateStatus;
    source: 'modrinth' | 'spigot' | null;
    projectTitle: string | null;
    projectUrl: string | null;
    latestVersion: string | null;
    latestGameVersions: string[];
    error: string | null;
    checkedAt: Date | null;
    rule: { id: number; type: 'blacklist' | 'link'; pattern: string | null; projectUrl: string | null } | null;
}

export interface PluginUpdateList {
    checking: boolean;
    lastCheckedAt: Date | null;
    plugins: PluginUpdate[];
}

export interface PluginUpdateRule {
    id: number;
    pluginName: string;
    type: 'blacklist' | 'link';
    // Blacklist rules match every plugin or jar name starting with this, e.g. "chestsorter".
    pattern: string | null;
    source: 'modrinth' | 'spigot' | null;
    projectUrl: string | null;
    createdAt: Date;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const rawDataToPluginUpdate = (data: any): PluginUpdate => ({
    fileName: data.file_name,
    pluginName: data.plugin_name,
    pluginVersion: data.plugin_version,
    pluginAuthors: data.plugin_authors || [],
    status: data.status,
    source: data.source,
    projectTitle: data.project_title,
    projectUrl: data.project_url,
    latestVersion: data.latest_version,
    latestGameVersions: data.latest_game_versions || [],
    error: data.error,
    checkedAt: data.checked_at ? new Date(data.checked_at) : null,
    rule: data.rule
        ? { id: data.rule.id, type: data.rule.type, pattern: data.rule.pattern, projectUrl: data.rule.project_url }
        : null,
});

export const getPluginUpdates = async (uuid: string): Promise<PluginUpdateList> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/plugin-updates`);

    return {
        checking: data.checking,
        lastCheckedAt: data.last_checked_at ? new Date(data.last_checked_at) : null,
        plugins: (data.plugins || []).map(rawDataToPluginUpdate),
    };
};

export const checkPluginUpdates = async (uuid: string): Promise<void> => {
    await http.post(`/api/client/servers/${uuid}/plugin-updates/check`);
};

export const updatePlugin = async (uuid: string, file: string): Promise<PluginUpdate | null> => {
    const { data } = await http.post(
        `/api/client/servers/${uuid}/plugin-updates/update`,
        { file },
        { timeout: 300000 }
    );

    return data.plugin ? rawDataToPluginUpdate(data.plugin) : null;
};

export const getPluginUpdateRules = async (): Promise<PluginUpdateRule[]> => {
    const { data } = await http.get('/api/client/plugin-updates/rules');

    return (data.rules || []).map((rule: any) => ({
        id: rule.id,
        pluginName: rule.plugin_name,
        type: rule.type,
        pattern: rule.pattern,
        source: rule.source,
        projectUrl: rule.project_url,
        createdAt: new Date(rule.created_at),
    }));
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const savePluginUpdateRule = async (
    pluginName: string,
    type: 'blacklist' | 'link',
    options: { url?: string; pattern?: string } = {}
) => {
    await http.post(
        '/api/client/plugin-updates/rules',
        { plugin_name: pluginName, type, url: options.url || null, pattern: options.pattern || null },
        { timeout: 120000 }
    );
};

export const deletePluginUpdateRule = async (id: number) => {
    await http.delete(`/api/client/plugin-updates/rules/${id}`, { timeout: 120000 });
};
