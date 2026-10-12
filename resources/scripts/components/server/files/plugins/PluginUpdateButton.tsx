import React from 'react';
import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowCircleUp, faBan } from '@fortawesome/free-solid-svg-icons';
import { usePluginUpdates } from '@/components/server/files/plugins/PluginUpdatesContext';
import { sourceLabel } from '@/components/server/files/plugins/PluginUpdateModal';
import { useStoreState } from '@/state/hooks';
import styles from '../style.module.css';

// Shown beside a plugin jar when the daily check found a newer downloadable version.
// On wide screens it sits in the gutter to the left of the row, otherwise inside the row.
export default ({ fileName }: { fileName: string }) => {
    const { enabled, byFile, open, blacklist } = usePluginUpdates();
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const plugin = enabled ? byFile.get(fileName) : undefined;

    if (!plugin || plugin.status !== 'update_available') {
        return null;
    }

    return (
        <div className={styles.plugin_update_actions}>
            {rootAdmin && (
                <button
                    type={'button'}
                    className={styles.plugin_blacklist_button}
                    title={'Blacklist: stop checking this plugin on every server'}
                    onClick={(e) => {
                        e.stopPropagation();
                        blacklist(fileName);
                    }}
                >
                    <FontAwesomeIcon icon={faBan} />
                </button>
            )}
            <button
                type={'button'}
                className={classNames(styles.plugin_update_button, {
                    [styles.source_modrinth]: plugin.source === 'modrinth',
                    [styles.source_spigot]: plugin.source === 'spigot',
                })}
                title={`Update ${plugin.pluginVersion} → ${plugin.latestVersion} (${sourceLabel(plugin.source)})`}
                onClick={(e) => {
                    e.stopPropagation();
                    open(fileName);
                }}
            >
                <FontAwesomeIcon icon={faArrowCircleUp} />
                <span className={styles.plugin_update_version}>{plugin.latestVersion}</span>
            </button>
        </div>
    );
};
