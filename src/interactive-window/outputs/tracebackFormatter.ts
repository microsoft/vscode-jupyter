// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCell, Uri } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { IGeneratedCode, IFileGeneratedCodes, IGeneratedCodeStorageFactory } from '../editor-integration/types';
import { untildify } from '../../platform/common/utils/platform';
import { traceInfoIfCI } from '../../platform/logging';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { IPlatformService } from '../../platform/common/platform/types';
import { stripAnsi } from '../../platform/common/utils/regexp';
import { InteractiveWindowView } from '../../platform/common/constants';
import { IConfigurationService } from '../../platform/common/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const _escapeRegExp = require('lodash/escapeRegExp') as typeof import('lodash/escapeRegExp'); // NOSONAR
const LineNumberMatchRegex = /(;32m[ ->]*?)(\d+)(.*)/g;

/**
 * Modifies error tracebacks from running cells in the Interactive Window. Modification can include:
 * - Providing links to files
 * - Removing ANSI escape sequences
 */
@injectable()
export class InteractiveWindowTracebackFormatter implements ITracebackFormatter {
    constructor(
        @inject(IGeneratedCodeStorageFactory) private readonly storageFactory: IGeneratedCodeStorageFactory,
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IConfigurationService) private configurationService: IConfigurationService
    ) {}
    public format(cell: NotebookCell, traceback: string[]): string[] {
        if (cell.notebook.notebookType !== InteractiveWindowView) {
            return traceback;
        }
        const storage = this.storageFactory.get({ notebook: cell.notebook });
        const useIPython8Format = traceback.some((traceFrame) => /^[Input|Cell|File].*?\n.*/.test(traceFrame));
        if (!useIPython8Format && !storage) {
            // nothing to modify for IPython7 if we don't have any code to look up (standalone Interactive Window)
            return traceback;
        }

        const settings = this.configurationService.getSettings(cell.document.uri);
        const linkifyLineNumbers = settings?.formatStackTraces ?? false;

        return traceback.map((traceFrame) => {
            // Check IPython8. We handle that one special
            if (useIPython8Format) {
                return this.modifyTracebackFrameIPython8(traceFrame, storage?.all, linkifyLineNumbers);
            } else if (linkifyLineNumbers) {
                return this.modifyTracebackFrameIPython7(traceFrame, storage!.all);
            } else {
                return traceFrame;
            }
        });
    }
    private modifyTracebackFrameIPython8(
        traceFrame: string,
        generatedCodes: IFileGeneratedCodes[] | undefined,
        linkifyLineNumbers: boolean
    ): string {
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

        let executionCount: number | undefined;
        let location: string | undefined;

        const cellRegex = /Cell\s+(?:\u001b\[.+?m)?In\s*\[(?<executionCount>\d+)\],\s*line (?<lineNumber>\d+).*/;
        const inputRegex = /Input\s+?(?:\u001b\[.+?m)?In\s*\[(?<executionCount>\d+)\].*line: (?<lineNumber>\d).*/;
        const inputMatch = inputRegex.exec(traceFrame);
        const cellMatch = cellRegex.exec(traceFrame);

        if (inputMatch && inputMatch.groups?.executionCount && inputMatch.groups?.lineNumber) {
            executionCount = parseInt(inputMatch.groups.executionCount);
            location = inputMatch.groups?.lineNumber;
        } else if (cellMatch && cellMatch.groups?.executionCount && cellMatch.groups?.lineNumber) {
            executionCount = parseInt(cellMatch.groups.executionCount);
            location = cellMatch.groups.lineNumber;
        }

        if (generatedCodes && executionCount) {
            // Find the cell that matches the execution count in group 1
            let matchUri: Uri | undefined;
            let match: IGeneratedCode | undefined;
            // eslint-disable-next-line no-restricted-syntax
            for (let entry of generatedCodes) {
                match = entry.generatedCodes.find((h) => h.executionCount === executionCount);
                if (match) {
                    matchUri = entry.uri;
                    break;
                }
            }
            if (match && matchUri) {
                // We have a match, replace source lines first
                let result = traceFrame;
                if (linkifyLineNumbers) {
                    result = result.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                        const n = parseInt(num, 10);
                        const lineNumberOfFirstLineInCell = match!.hasCellMarker ? match!.line - 1 : match!.line;
                        const lineIndexOfFirstLineInCell = lineNumberOfFirstLineInCell - 1;
                        const newLine =
                            lineIndexOfFirstLineInCell + match!.lineOffsetRelativeToIndexOfFirstLineInCell + n;
                        return `${prefix}<a href='${matchUri?.toString()}?line=${newLine - 1}'>${newLine}</a>${suffix}`;
                    });
                }

                // Then replace the input line with our uri for this cell
                return result.replace(/.*?\n/, `File \u001b[1;32m${getFilePath(matchUri)}:${location}\u001b[0m\n`);
            }
        }

        if (linkifyLineNumbers) {
            const fileMatch = /^File.*?\[\d;32m(.*):\d+.*\u001b.*\n/.exec(traceFrame);
            if (fileMatch && fileMatch.length > 1) {
                // We need to untilde the file path here for the link to work in VS Code
                const detildePath = untildify(fileMatch[1], getFilePath(this.platformService.homeDir));
                const fileUri = Uri.file(detildePath);
                // We have a match, replace source lines with hrefs
                return traceFrame.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                    const n = parseInt(num, 10);
                    return `${prefix}<a href='${fileUri?.toString()}?line=${n - 1}'>${n}</a>${suffix}`;
                });
            }
        }

        return traceFrame;
    }
    private modifyTracebackFrameIPython7(traceFrame: string, allGeneratedCodes: IFileGeneratedCodes[]): string {
        const allUris = allGeneratedCodes.map((item) => item.uri);
        allUris.forEach((uri) => {
            const filePath = getFilePath(uri);
            const displayPath = getDisplayPath(uri);
            const storage = this.storageFactory.get({ fileUri: uri });
            if (!storage) {
                return;
            }

            if (
                (traceFrame.includes(filePath) &&
                    new RegExp(`\\[.*?;32m${_escapeRegExp(filePath)}`).test(traceFrame)) ||
                (traceFrame.includes(displayPath) &&
                    new RegExp(`\\[.*?;32m${_escapeRegExp(displayPath)}`).test(traceFrame))
            ) {
                // We have a match, pull out the source lines
                let sourceLines = '';
                const regex = /(;32m[ ->]*?)(\d+)(.*)/g;
                for (let l = regex.exec(traceFrame); l && l.length > 3; l = regex.exec(traceFrame)) {
                    const newLine = stripAnsi(l[3]).substr(1); // Seem to have a space on the front
                    sourceLines = `${sourceLines}${newLine}\n`;
                }

                // Now attempt to find a cell that matches these source lines
                const offset = this.findCellOffset(storage.getFileGeneratedCode(uri), sourceLines);
                if (offset !== undefined) {
                    traceFrame = traceFrame.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                        const n = parseInt(num, 10);
                        const newLine = offset + n - 1;
                        return `${prefix}<a href='${uri.toString()}?line=${newLine}'>${newLine + 1}</a>${suffix}`;
                    });
                }
            }

            if (traceFrame.includes(filePath)) {
                const offset = this.findCellOffset(storage.getFileGeneratedCode(uri), traceFrame);
                if (offset) {
                    return traceFrame.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                        const n = parseInt(num, 10);
                        const newLine = offset + n - 1;
                        return `${prefix}<a href='${uri.toString()}?line=${newLine}'>${newLine + 1}</a>${suffix}`;
                    });
                }
            }
        });

        return traceFrame;
    }
    private findCellOffset(generatedCodes: IGeneratedCode[] | undefined, codeLines: string): number | undefined {
        if (generatedCodes) {
            // Go through all cell code looking for these code lines exactly
            // (although with right side trimmed as that's what a stack trace does)
            for (const hash of generatedCodes) {
                const index = hash.trimmedRightCode.indexOf(codeLines);
                if (index >= 0) {
                    // Jupyter isn't counting blank lines at the top so use our
                    // first non blank line
                    return hash.firstNonBlankLineIndex;
                }
            }
        }
        // No hash found
        return undefined;
    }
}
