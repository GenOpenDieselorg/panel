import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import tw from 'twin.macro';
import { Server } from '@/api/server/getServer';

interface Marker {
    uuid: string;
    name: string;
    fraction: number;
}

interface Props {
    servers: Server[];
    conflictServerUuids: string[];
    // Changes to this value force the marker positions to be re-measured.
    recomputeKey?: unknown;
    onSelect: (uuid: string) => void;
}

/*
 * Renders red markers along the right edge of the viewport (aligned with the page
 * scrollbar) at the positions of servers with plugin version conflicts. Only shown
 * when the page actually scrolls. Clicking a marker scrolls to that server.
 */
export default ({ servers, conflictServerUuids, recomputeKey, onSelect }: Props) => {
    const [markers, setMarkers] = useState<Marker[]>([]);

    useEffect(() => {
        let frame: number | null = null;

        const measure = () => {
            const scrollHeight = document.documentElement.scrollHeight;

            if (scrollHeight <= window.innerHeight + 4) {
                setMarkers([]);

                return;
            }

            const names = new Map(servers.map((server) => [server.uuid, server.name]));
            const next: Marker[] = [];

            for (const uuid of conflictServerUuids) {
                const element = document.getElementById(`dashboard-server-${uuid}`);
                if (!element) {
                    continue;
                }

                const rect = element.getBoundingClientRect();
                const center = rect.top + window.scrollY + rect.height / 2;

                next.push({
                    uuid,
                    name: names.get(uuid) ?? uuid,
                    fraction: Math.min(Math.max(center / scrollHeight, 0), 1),
                });
            }

            setMarkers(next);
        };

        const scheduleMeasure = () => {
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }

            frame = requestAnimationFrame(measure);
        };

        scheduleMeasure();
        // Re-measure once more after the layout has settled (fonts, row content, etc.).
        const settleTimer = setTimeout(scheduleMeasure, 500);
        window.addEventListener('resize', scheduleMeasure);

        return () => {
            window.removeEventListener('resize', scheduleMeasure);
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }
            clearTimeout(settleTimer);
        };
    }, [servers, conflictServerUuids.join(','), recomputeKey]);

    if (markers.length === 0) {
        return null;
    }

    return createPortal(
        <div css={tw`fixed inset-y-0 right-0 w-3 z-50 pointer-events-none`}>
            {markers.map((marker) => (
                <div
                    key={marker.uuid}
                    title={`Plugin conflict: ${marker.name}`}
                    css={tw`absolute right-0 w-3 h-2 rounded-l bg-red-500 opacity-75 hover:opacity-100 cursor-pointer pointer-events-auto shadow`}
                    style={{ top: `calc(${(marker.fraction * 100).toFixed(3)}% - 4px)` }}
                    onClick={() => onSelect(marker.uuid)}
                />
            ))}
        </div>,
        document.body
    );
};
