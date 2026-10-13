// Grouping is done on the file name only. A jar name is split into tokens on separators and cut
// at the first token that looks like a version or build marker, e.g.
//   "TreeCuter-build-7-5df4f9d"        -> "TreeCuter"
//   "TreeCuter-v2.4.0"                 -> "TreeCuter"
//   "UltraCosmetics-3.15-DEV-b1"       -> "UltraCosmetics"
//   "squaremap-paper-mc1.21.11-1.3.12" -> "squaremap"
//   "topper-spigot-plugin-4.7.0-shaded (2)" -> "topper"
// Names that simply end in digits ("mcMMO", "Slimefun4") survive, as the digits are not a token.
const PLUGIN_COPY_SUFFIX_REGEX = /\s*\(\d+\)$/;
const TOKEN_SEPARATOR_REGEX = /[-_\s.+]+/;

// Tokens that start the version part of a name: "2", "v2", "mc1", "b17", "r3", a git hash.
const isVersionToken = (token: string): boolean =>
    /^(?:v|mc|b|r|build)?\d/i.test(token) || (/^[0-9a-f]{6,40}$/i.test(token) && /\d/.test(token));

// Words that mark a build or release rather than the plugin itself, also cut on.
const BUILD_WORDS = new Set([
    'build',
    'snapshot',
    'dev',
    'alpha',
    'beta',
    'pre',
    'rc',
    'nightly',
    'release',
    'final',
    'stable',
    'latest',
]);

// Packaging and platform words dropped from the end of what is left.
const TRAILING_NOISE_WORDS = new Set([
    'shaded',
    'all',
    'jar',
    'plugin',
    'bukkit',
    'spigot',
    'paper',
    'folia',
    'purpur',
    'velocity',
    'bungee',
    'bungeecord',
    'universal',
    'copy',
]);

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

    const tokens = file.name
        .replace(/\.jar$/i, '')
        .replace(PLUGIN_COPY_SUFFIX_REGEX, '')
        .trim()
        .split(TOKEN_SEPARATOR_REGEX)
        .filter(Boolean);

    if (!tokens.length) {
        return null;
    }

    // The first token is always kept, so a name made only of version-ish tokens still keys on something.
    let end = tokens.findIndex(
        (token, index) => index > 0 && (isVersionToken(token) || BUILD_WORDS.has(token.toLowerCase()))
    );
    if (end === -1) {
        end = tokens.length;
    }

    while (end > 1 && TRAILING_NOISE_WORDS.has(tokens[end - 1].toLowerCase())) {
        end--;
    }

    const parts = tokens.slice(0, end);

    return {
        // Separators are ignored in the key, so "Tree-Cuter" and "TreeCuter" collide too.
        key: parts.join('').toLowerCase(),
        name: parts.join('-'),
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
