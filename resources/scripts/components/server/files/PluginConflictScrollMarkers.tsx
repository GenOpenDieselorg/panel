import React from 'react';
import tw from 'twin.macro';

export interface PluginConflictMarker {
    name: string;
    // Position of the row within the list, from 0 (top) to 1 (bottom).
    ratio: number;
}

const scrollToFile = (name: string) => {
    const rows = document.querySelectorAll<HTMLElement>('[data-plugin-version-conflict="true"]');

    rows.forEach((row) => {
        if (row.dataset.fileName === name) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
};

// Renders a fixed vertical rail near the right edge of the viewport with a tick
// for each detected duplicate plugin, mapping its position within the file list.
// Positioned clear of the native scrollbar so the ticks stay visible. Ticks are
// clickable and scroll the matching row into view. Hidden on small screens.
const PluginConflictScrollMarkers = ({ markers }: { markers: PluginConflictMarker[] }) => {
    if (markers.length === 0) {
        return null;
    }

    return (
        <div
            css={tw`hidden md:block fixed z-50 pointer-events-none`}
            style={{ right: 24, top: '12vh', height: '76vh', width: 12 }}
        >
            <div
                css={tw`relative w-full h-full rounded-full bg-neutral-800 border border-neutral-600 shadow-lg pointer-events-auto`}
            >
                {markers.map((marker) => (
                    <button
                        key={marker.name}
                        type={'button'}
                        title={`Przewiń do: ${marker.name}`}
                        aria-label={`Przewiń do ${marker.name}`}
                        onClick={() => scrollToFile(marker.name)}
                        css={tw`absolute -left-0.5 -right-0.5 h-2 rounded bg-red-500 hover:bg-red-400 ring-1 ring-red-900 cursor-pointer transition-colors`}
                        style={{ top: `${marker.ratio * 100}%`, transform: 'translateY(-50%)' }}
                    />
                ))}
            </div>
        </div>
    );
};

export default PluginConflictScrollMarkers;
