// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookCell } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { JupyterNotebookView } from '../../platform/common/constants';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { traceInfoIfCI } from '../../platform/logging';
const LineNumberMatchRegex = /(;32m[ ->]*?)(\d+)(.*)/g;

/**
 * Used to format the traceback of an error in a notebook
 */
@injectable()
export class NotebookTracebackFormatter implements ITracebackFormatter {
    public format(cell: NotebookCell, traceback: string[]): string[] {
        if (cell.notebook.notebookType !== JupyterNotebookView) {
            return traceback;
        }

        return traceback.map((traceFrame) => this.modifyTracebackFrameIPython(cell, traceFrame));
    }
    private modifyTracebackFrameIPython(cell: NotebookCell, traceFrame: string): string {
        if (/^[Cell|Input|File].*?\n.*/.test(traceFrame)) {
            return this.modifyTracebackFrameIPython8(cell, traceFrame);
        } else {
            return traceFrame;
        }
    }
    private modifyTracebackFrameIPython8(cell: NotebookCell, traceFrame: string): string {
        // Ansi colors are described here:
        // https://en.wikipedia.org/wiki/ANSI_escape_code under the SGR section

        // First step is always to remove background colors. They don't work well with
        // themes 40-49 sets background color
        traceFrame = traceFrame.replace(/\u001b\[4\dm/g, '');

        // Also remove specific foreground colors (38 is the ascii code for picking one) (they don't translate either)
        // Turn them into default foreground
        traceFrame = traceFrame.replace(/\u001b\[38;.*?\d+m/g, '\u001b[39m');

        // Turn all foreground colors after the --> to default foreground
        traceFrame = traceFrame.replace(/(;32m[ ->]*?)(\d+)(.*)\n/g, (_s, prefix, num, suffix) => {
            suffix = suffix.replace(/\u001b\[3\d+m/g, '\u001b[39m');
            return `${prefix}${num}${suffix}\n`;
        });

        traceInfoIfCI(`Trace frame to match: ${traceFrame}`);

        const tracebackLinkify = (traceFrame: string, line: string) => {
            // We have a match, replace source lines first
            const afterLineReplace = traceFrame.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                const n = parseInt(num, 10);
                return `${prefix}<a href='${cell.document.uri.toString()}?line=${n - 1}'>${n}</a>${suffix}`;
            });

            // Then replace the input line with our uri for this cell: '<cell line: 2>[0;34m()[0m\n'
            const cellAt = DataScience.cellAtFormat(getFilePath(cell.document.uri), cell.index + 1);
            return afterLineReplace.replace(/.*?\n/, `\u001b[1;32m${cellAt}\u001b[0m line \u001b[0;36m${line}\n`);
        };

        const inputMatch = /^Input.*?\[.*32mIn\s+\[(\d+).*?0;36m(.*?)\n.*/.exec(traceFrame);
        if (inputMatch && inputMatch.length > 1) {
            return tracebackLinkify(traceFrame, inputMatch[2]);
        }

        const cellMatch = /Cell.*?\[.*32mIn\s?\[(\d+)\]\,\s+line\s+([(\d+)])(.*?)\n.*/gm.exec(traceFrame);
        if (cellMatch && cellMatch.length > 1) {
            return tracebackLinkify(traceFrame, cellMatch[2]);
        }

        return traceFrame;
    }
}
