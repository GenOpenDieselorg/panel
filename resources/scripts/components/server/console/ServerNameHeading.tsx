import React, { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencilAlt } from '@fortawesome/free-solid-svg-icons';
import { ServerContext } from '@/state/server';
import setServerNickname from '@/api/server/setServerNickname';

// The server name above the console. Clicking the pencil lets the user set a private nickname
// that only they see, everywhere in the panel; clearing it brings back the real name.
export default () => {
    const server = ServerContext.useStoreState((state) => state.server.data!);
    const setServerFromState = ServerContext.useStoreActions((actions) => actions.server.setServerFromState);
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) input.current?.select();
    }, [editing]);

    const start = () => {
        setValue(server.name);
        setError(false);
        setEditing(true);
    };

    const save = () => {
        if (saving) return;

        setSaving(true);
        setServerNickname(server.uuid, value.trim() || null)
            .then((nickname) => {
                setServerFromState((s) => ({ ...s, nickname, name: nickname || s.originalName }));
                setEditing(false);
            })
            .catch(() => setError(true))
            .finally(() => setSaving(false));
    };

    if (editing) {
        return (
            <div className={'flex items-center gap-2'}>
                <input
                    ref={input}
                    value={value}
                    maxLength={191}
                    disabled={saving}
                    onChange={(e) => setValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') save();
                        if (e.key === 'Escape') setEditing(false);
                    }}
                    onBlur={save}
                    placeholder={server.originalName}
                    className={`w-full font-header font-medium text-2xl leading-relaxed bg-gray-700 text-gray-50 rounded px-2 border ${
                        error ? 'border-red-500' : 'border-blue-500'
                    } focus:outline-none`}
                />
            </div>
        );
    }

    return (
        <div className={'group flex items-center gap-3 min-w-0'}>
            <h1 className={'font-header font-medium text-2xl text-gray-50 leading-relaxed line-clamp-1'}>
                {server.name}
            </h1>
            <button
                type={'button'}
                onClick={start}
                title={'Rename for yourself only (other users still see the real name)'}
                className={
                    'flex-none text-gray-400 hover:text-gray-100 opacity-0 group-hover:opacity-100 transition-opacity'
                }
            >
                <FontAwesomeIcon icon={faPencilAlt} />
            </button>
            {server.nickname && (
                <span className={'flex-none text-xs text-gray-400 truncate'} title={'Real server name'}>
                    ({server.originalName})
                </span>
            )}
        </div>
    );
};
