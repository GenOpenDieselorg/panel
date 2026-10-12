// Files opened in the log viewer rather than the editor: plain and rotated (.log.gz) logs, and
// crash reports, which Minecraft writes as .txt files.
export const isLogFile = (path: string): boolean =>
    /\.log(\.gz)?$/i.test(path) || (/(^|\/)crash-reports\//i.test(path) && /\.txt$/i.test(path));

export type LogLevel = 'error' | 'warn' | 'info';

export interface LogLine {
    number: number;
    text: string;
    level: LogLevel;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

const ERROR =
    /(\/(ERROR|SEVERE|FATAL)\]|\[(ERROR|SEVERE|FATAL)\]|\b(ERROR|SEVERE|FATAL)\b:|Exception\b|^\s*Caused by:|^---- Minecraft Crash Report ----)/;
const WARN = /(\/WARN(ING)?\]|\[WARN(ING)?\]|\bWARN(ING)?\b:)/;
// Lines that continue the previous entry, such as the frames of a stack trace.
const CONTINUATION = /^(\s+at |\s+\.\.\. \d+ more|\s*Caused by:|\t)/;
// Lines that start a new log entry, e.g. "[12:34:56] [Server thread/INFO]:".
const NEW_ENTRY = /^\[\d{2}:\d{2}:\d{2}/;

export const parseLog = (contents: string): LogLine[] => {
    const lines = contents.replace(ANSI, '').split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    const isCrashReport = lines[0]?.startsWith('---- Minecraft Crash Report ----');
    let previous: LogLevel = 'info';

    return lines.map((text, index) => {
        let level: LogLevel;

        if (isCrashReport) {
            level = 'error';
        } else if (ERROR.test(text)) {
            level = 'error';
        } else if (WARN.test(text)) {
            level = 'warn';
        } else if (previous !== 'info' && (CONTINUATION.test(text) || !NEW_ENTRY.test(text))) {
            // Stack traces and multi-line messages stay with the entry they belong to.
            level = previous;
        } else {
            level = 'info';
        }

        previous = level;

        return { number: index + 1, text, level };
    });
};
