import http from '@/api/http';

export default async (server: string, file: string): Promise<string> => {
    const { data } = await http.get(`/api/client/servers/${server}/files/log`, {
        params: { file },
        transformResponse: (res) => res,
        responseType: 'text',
        timeout: 120000,
    });

    return data;
};
