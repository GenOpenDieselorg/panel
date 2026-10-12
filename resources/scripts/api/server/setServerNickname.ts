import http from '@/api/http';

export default async (uuid: string, name: string | null): Promise<string | null> => {
    const { data } = await http.put(`/api/client/servers/${uuid}/nickname`, { name });

    return data.nickname;
};
