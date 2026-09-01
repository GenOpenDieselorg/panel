import http from '@/api/http';

export interface ClonePlugin {
    name: string;
    type: 'file' | 'directory';
}

export type CleanupMode = 'remove' | 'keep';

export interface CloneCleanupPluginsResponse {
    plugins: ClonePlugin[];
    template: string;
    mode: CleanupMode;
    selection: string[];
}

export const getCloneCleanupPlugins = (uuid: string): Promise<CloneCleanupPluginsResponse> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/servers/${uuid}/clone-cleanup/plugins`)
            .then(({ data }) =>
                resolve({
                    plugins: data.plugins || [],
                    template: data.template || '',
                    mode: data.mode === 'keep' ? 'keep' : 'remove',
                    selection: data.selection || [],
                })
            )
            .catch(reject);
    });
};

export const applyCloneCleanup = (
    uuid: string,
    mode: CleanupMode,
    plugins: string[],
    patterns?: string[]
): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/servers/${uuid}/clone-cleanup`, { mode, plugins, patterns })
            .then(() => resolve())
            .catch(reject);
    });
};
