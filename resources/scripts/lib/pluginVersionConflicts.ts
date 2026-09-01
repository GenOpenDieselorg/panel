const PLUGIN_COPY_SUFFIX_REGEX = /\s+\(\d+\)$/;
// The version may be followed by any number of qualifier segments, so builds like
// "UltraCosmetics-3.15-DEV-b1" collapse to the same base name as "UltraCosmetics-3.16-RELEASE".
const PLUGIN_VERSION_SUFFIX_REGEX = /^(.*?)(?:[-_\s.]v?)(\d+(?:[._-]\d+)*(?:[-_+][a-z0-9]+)*)$/i;
// Leftover version-ish tokens after the first split, e.g. the game version in
// "squaremap-paper-mc1.21.11-1.3.12", which otherwise keys as "squaremap-paper-mc1".
// Requires a separator, so names that simply end in digits ("mcMMO", "Slimefun4") survive.
const PLUGIN_TRAILING_VERSION_TOKEN_REGEX = /[-_\s.](?:mc|minecraft)?v?\d+(?:[._-]\d+)*(?:[-_+][a-z0-9]+)*$/i;

interface PluginFile {
    name: string;
    isFile: boolean;
}

export type PluginVersionConflict = {
    name: string;
    files: string[];
};

const getPluginVersionParts = (file: PluginFile): { key: string; name: string } | null => {
    if (!file.isFile || !file.name.toLowerCase().endsWith('.jar')) {
        return null;
    }

    const fileNameWithoutExtension = file.name
        .replace(/\.jar$/i, '')
        .replace(PLUGIN_COPY_SUFFIX_REGEX, '')
        .trim();
    const match = fileNameWithoutExtension.match(PLUGIN_VERSION_SUFFIX_REGEX);

    // When the name carries a version suffix (e.g. "Plugin-1.2"), group by the
    // versionless base name so different versions collide. Otherwise fall back to
    // the whole base name, so plain copies like "ProtocolLib (4)" / "ProtocolLib (18)"
    // still group together instead of being dropped.
    let name = match ? match[1].replace(/[-_\s.]+$/, '').trim() : fileNameWithoutExtension;

    // Strip any remaining version tokens (game version, build number) one by one, but never
    // down to nothing — a name made only of version tokens keeps its last meaningful part.
    while (PLUGIN_TRAILING_VERSION_TOKEN_REGEX.test(name)) {
        const stripped = name.replace(PLUGIN_TRAILING_VERSION_TOKEN_REGEX, '').replace(/[-_\s.]+$/, '').trim();

        if (!stripped) {
            break;
        }

        name = stripped;
    }

    if (!name) {
        return null;
    }

    return {
        key: name.toLowerCase(),
        name,
    };
};

export const findPluginVersionConflicts = (files: PluginFile[]): PluginVersionConflict[] => {
    const groups = new Map<string, { name: string; files: string[] }>();

    files.forEach((file) => {
        const plugin = getPluginVersionParts(file);

        if (!plugin) {
            return;
        }

        const group = groups.get(plugin.key) || { name: plugin.name, files: [] };

        group.files.push(file.name);
        groups.set(plugin.key, group);
    });

    return Array.from(groups.values())
        .filter((group) => group.files.length > 1)
        .map((group) => ({ name: group.name, files: group.files }));
};
