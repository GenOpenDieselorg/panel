import http from '@/api/http';

export interface CreateServerFromBackupResponse {
    uuid: string;
    identifier: string;
}

export default (
    uuid: string,
    backup: string,
    name?: string,
    nodeId?: number,
    pluginTemplate?: string,
    memoryMiB?: number,
    paperVersion?: string,
    pluginMode?: 'remove' | 'keep',
    plugins?: string[]
): Promise<CreateServerFromBackupResponse> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/servers/${uuid}/backups/${backup}/create-server`, {
            name,
            node_id: nodeId,
            plugin_template: pluginTemplate,
            memory_mib: memoryMiB,
            paper_version: paperVersion,
            plugin_mode: pluginMode,
            plugins,
        })
            .then(({ data }) =>
                resolve({
                    uuid: data.attributes.uuid,
                    identifier: data.attributes.identifier,
                })
            )
            .catch(reject);
    });
};
