import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowCircleUp } from '@fortawesome/free-solid-svg-icons';
import { usePluginUpdates } from '@/components/server/files/plugins/PluginUpdatesContext';
import { sourceLabel } from '@/components/server/files/plugins/PluginUpdateModal';
import styles from '../style.module.css';

// Shown beside a plugin jar when the daily check found a newer downloadable version.
// On wide screens it sits in the gutter to the left of the row, otherwise inside the row.
export default ({ fileName }: { fileName: string }) => {
    const { enabled, byFile, open } = usePluginUpdates();
    const plugin = enabled ? byFile.get(fileName) : undefined;

    if (!plugin || plugin.status !== 'update_available') {
        return null;
    }

    return (
        <button
            type={'button'}
            className={styles.plugin_update_button}
            title={`Aktualizacja ${plugin.pluginVersion} → ${plugin.latestVersion} (${sourceLabel(plugin.source)})`}
            onClick={(e) => {
                e.stopPropagation();
                open(fileName);
            }}
        >
            <FontAwesomeIcon icon={faArrowCircleUp} />
            <span className={styles.plugin_update_version}>{plugin.latestVersion}</span>
        </button>
    );
};
