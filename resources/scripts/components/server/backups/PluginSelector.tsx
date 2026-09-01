import React, { useMemo, useState } from 'react';
import tw from 'twin.macro';
import Button from '@/components/elements/Button';
import Input from '@/components/elements/Input';
import { CleanupMode, ClonePlugin } from '@/api/server/cloneCleanup';

interface Props {
    plugins: ClonePlugin[];
    loading?: boolean;
    mode: CleanupMode;
    selected: string[];
    onModeChange: (mode: CleanupMode) => void;
    onSelectedChange: (selected: string[]) => void;
}

/**
 * Lets the user pick plugin jars either to delete or to keep. Only *.jar files
 * are ever listed — directories inside /plugins are left untouched.
 */
const PluginSelector = ({ plugins, loading, mode, selected, onModeChange, onSelectedChange }: Props) => {
    const [search, setSearch] = useState('');

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();

        return term === '' ? plugins : plugins.filter((plugin) => plugin.name.toLowerCase().includes(term));
    }, [plugins, search]);

    const deletionCount = mode === 'keep' ? plugins.length - selected.length : selected.length;

    const toggle = (name: string) =>
        onSelectedChange(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]);

    return (
        <div>
            <div css={tw`flex gap-2 mb-3`}>
                <Button
                    type={'button'}
                    size={'xsmall'}
                    color={'primary'}
                    isSecondary={mode !== 'remove'}
                    onClick={() => onModeChange('remove')}
                >
                    Remove selected
                </Button>
                <Button
                    type={'button'}
                    size={'xsmall'}
                    color={'primary'}
                    isSecondary={mode !== 'keep'}
                    onClick={() => onModeChange('keep')}
                >
                    Keep only selected
                </Button>
            </div>
            <p css={tw`text-xs text-neutral-400 mb-3`}>
                {mode === 'remove'
                    ? 'Ticked plugins will be deleted after the backup is restored.'
                    : 'Only the ticked plugins will survive — every other jar is deleted after the restore.'}{' '}
                Folders are never touched.
            </p>
            {loading ? (
                <p css={tw`text-sm text-neutral-400`}>Loading plugins…</p>
            ) : plugins.length === 0 ? (
                <p css={tw`text-sm text-neutral-400`}>No plugin jars were found in /plugins.</p>
            ) : (
                <>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={'Search plugins…'}
                        css={tw`mb-2`}
                    />
                    <div css={tw`flex items-center justify-between mb-2`}>
                        <span css={tw`text-xs text-neutral-400`}>
                            {selected.length} of {plugins.length} selected
                        </span>
                        <div css={tw`flex gap-3`}>
                            <button
                                type={'button'}
                                css={tw`text-xs text-neutral-300 hover:text-neutral-100`}
                                onClick={() => onSelectedChange(plugins.map((plugin) => plugin.name))}
                            >
                                Select all
                            </button>
                            <button
                                type={'button'}
                                css={tw`text-xs text-neutral-300 hover:text-neutral-100`}
                                onClick={() => onSelectedChange([])}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    <div css={tw`max-h-64 overflow-y-auto space-y-1 mb-2`}>
                        {visible.length === 0 ? (
                            <p css={tw`text-xs text-neutral-400 py-2`}>Nothing matches “{search}”.</p>
                        ) : (
                            visible.map((plugin) => (
                                <label
                                    key={plugin.name}
                                    htmlFor={`select_plugin_${plugin.name}`}
                                    css={tw`flex items-center cursor-pointer bg-neutral-800 rounded px-3 py-2`}
                                >
                                    <Input
                                        id={`select_plugin_${plugin.name}`}
                                        type={'checkbox'}
                                        css={tw`w-4! h-4! mr-3`}
                                        checked={selected.includes(plugin.name)}
                                        onChange={() => toggle(plugin.name)}
                                    />
                                    <span css={tw`text-sm text-neutral-100 break-all`}>{plugin.name}</span>
                                </label>
                            ))
                        )}
                    </div>
                    <p css={[tw`text-xs`, deletionCount > 0 ? tw`text-red-400` : tw`text-neutral-400`]}>
                        {deletionCount === 0
                            ? 'Nothing will be deleted.'
                            : `${deletionCount} plugin${deletionCount === 1 ? '' : 's'} will be deleted.`}
                    </p>
                </>
            )}
        </div>
    );
};

export default PluginSelector;
