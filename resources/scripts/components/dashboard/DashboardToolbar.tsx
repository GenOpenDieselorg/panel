import React, { useState } from 'react';
import tw from 'twin.macro';
import { Button } from '@/components/elements/button/index';
import Select from '@/components/elements/Select';
import Input from '@/components/elements/Input';
import { DashboardSortMode } from '@/lib/dashboardLayout';
import { Dialog } from '@/components/elements/dialog';

interface Props {
    sortMode: DashboardSortMode;
    isOrganizing: boolean;
    onSortModeChange: (mode: DashboardSortMode) => void;
    onToggleOrganizing: () => void;
    onCreateSection: (name: string) => void;
}

export default ({ sortMode, isOrganizing, onSortModeChange, onToggleOrganizing, onCreateSection }: Props) => {
    const [open, setOpen] = useState(false);
    const [sectionName, setSectionName] = useState('');

    const handleCreate = () => {
        const name = sectionName.trim();
        if (!name) {
            return;
        }

        onCreateSection(name);
        setSectionName('');
        setOpen(false);
    };

    return (
        <>
            <div css={tw`mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
                <div css={tw`flex flex-col gap-2 sm:flex-row sm:items-center`}>
                    <label css={tw`text-xs uppercase text-neutral-400`}>Sort by</label>
                    <Select
                        css={tw`sm:w-56`}
                        value={sortMode}
                        onChange={(event) => onSortModeChange(event.currentTarget.value as DashboardSortMode)}
                    >
                        <option value={'custom'}>Custom order</option>
                        <option value={'name_asc'}>Name A-Z</option>
                        <option value={'name_desc'}>Name Z-A</option>
                    </Select>
                </div>
                <div css={tw`flex flex-wrap gap-2`}>
                    <Button type={'button'} variant={Button.Variants.Secondary} onClick={() => setOpen(true)}>
                        Add section
                    </Button>
                    <Button
                        type={'button'}
                        variant={isOrganizing ? Button.Variants.Primary : Button.Variants.Secondary}
                        onClick={onToggleOrganizing}
                    >
                        {isOrganizing ? 'Save layout' : 'Organize servers'}
                    </Button>
                </div>
            </div>

            <Dialog open={open} onClose={() => setOpen(false)} title={'New section'}>
                <div css={tw`space-y-4`}>
                    <p css={tw`text-sm text-neutral-300`}>
                        Create a section, e.g. &quot;Production servers&quot; or &quot;Test servers&quot;, then drag
                        servers into it while in organize mode.
                    </p>
                    <Input
                        value={sectionName}
                        onChange={(event) => setSectionName(event.currentTarget.value)}
                        placeholder={'Section name'}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                handleCreate();
                            }
                        }}
                    />
                    <div css={tw`flex justify-end gap-2`}>
                        <Button type={'button'} variant={Button.Variants.Secondary} onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type={'button'} onClick={handleCreate}>
                            Create
                        </Button>
                    </div>
                </div>
            </Dialog>
        </>
    );
};
