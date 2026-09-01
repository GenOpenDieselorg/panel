import React, { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faLevelUpAlt } from '@fortawesome/free-solid-svg-icons';
import { Dialog } from '@/components/elements/dialog';
import { Button } from '@/components/elements/button/index';
import Spinner from '@/components/elements/Spinner';
import loadDirectory, { FileObject } from '@/api/server/files/loadDirectory';
import { httpErrorToHuman } from '@/api/http';

interface Props {
    uuid: string;
    open: boolean;
    startPath: string;
    onClose: () => void;
    onSelect: (path: string) => void;
}

const joinPath = (base: string, name: string): string => (base === '/' ? `/${name}` : `${base}/${name}`);

const parentPath = (path: string): string => {
    const parts = path.split('/').filter((part) => part.length > 0);
    parts.pop();

    return parts.length === 0 ? '/' : `/${parts.join('/')}`;
};

export default ({ uuid, open, startPath, onClose, onSelect }: Props) => {
    const [path, setPath] = useState(startPath || '/');
    const [directories, setDirectories] = useState<FileObject[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setPath(startPath || '/');
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        loadDirectory(uuid, path)
            .then((files) => {
                if (cancelled) {
                    return;
                }

                setDirectories(
                    files
                        .filter((file) => !file.isFile && !file.isSymlink)
                        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                );
            })
            .catch((error) => {
                if (!cancelled) {
                    setDirectories([]);
                    setError(httpErrorToHuman(error));
                }
            })
            .then(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, path, uuid]);

    return (
        <Dialog open={open} onClose={onClose} title={'Wybierz katalog'}>
            <div css={tw`space-y-3`}>
                <p css={tw`text-sm text-neutral-400 break-all`}>
                    Bieżący katalog: <code css={tw`text-neutral-200`}>{path}</code>
                </p>

                <div css={tw`rounded bg-neutral-900 max-h-64 overflow-y-auto`}>
                    {path !== '/' && (
                        <button
                            type={'button'}
                            css={tw`w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700 text-left`}
                            onClick={() => setPath(parentPath(path))}
                        >
                            <FontAwesomeIcon icon={faLevelUpAlt} css={tw`text-neutral-500`} fixedWidth />
                            .. (katalog wyżej)
                        </button>
                    )}
                    {loading ? (
                        <div css={tw`p-4`}>
                            <Spinner centered size={'small'} />
                        </div>
                    ) : error ? (
                        <p css={tw`p-3 text-sm text-red-400`}>{error}</p>
                    ) : directories.length === 0 ? (
                        <p css={tw`p-3 text-sm text-neutral-500`}>Brak podkatalogów.</p>
                    ) : (
                        directories.map((directory) => (
                            <button
                                key={directory.key}
                                type={'button'}
                                css={tw`w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 text-left break-all`}
                                onClick={() => setPath(joinPath(path, directory.name))}
                            >
                                <FontAwesomeIcon icon={faFolder} css={tw`text-cyan-500`} fixedWidth />
                                {directory.name}
                            </button>
                        ))
                    )}
                </div>

                <div css={tw`flex justify-end gap-2`}>
                    <Button type={'button'} variant={Button.Variants.Secondary} onClick={onClose}>
                        Anuluj
                    </Button>
                    <Button
                        type={'button'}
                        onClick={() => {
                            onSelect(path);
                            onClose();
                        }}
                    >
                        Wybierz ten katalog
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};
