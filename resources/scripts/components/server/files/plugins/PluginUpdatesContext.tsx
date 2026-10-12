import { createContext, useContext } from 'react';
import { PluginUpdate } from '@/api/server/plugins/pluginUpdates';

interface PluginUpdatesContextValue {
    enabled: boolean;
    byFile: Map<string, PluginUpdate>;
    open: (fileName: string) => void;
}

export const PluginUpdatesContext = createContext<PluginUpdatesContextValue>({
    enabled: false,
    byFile: new Map(),
    open: () => undefined,
});

export const usePluginUpdates = () => useContext(PluginUpdatesContext);
