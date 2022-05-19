// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookCell } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { JupyterNotebookView } from '../constants';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const LineNumberMatchRegex = /(;32m[ ->]*?)(\d+)(.*)/g;

@injectable()
export class NotebookTracebackFormatter implements ITracebackFormatter {
    format(cell: NotebookCell, traceback: string[]): string[] {
        if (cell.notebook.notebookType !== JupyterNotebookView) {
            return traceback;
        }
        return traceback.map((line) => {
            const inputMatch = /^Input.*?\[.*32mIn\s+\[(\d+).*?0;36m(.*?)\n.*/.exec(line);

            // We have a match, replace source lines first
            const afterLineReplace = line.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                const n = parseInt(num, 10);
                return `${prefix}<a href='${cell.document.uri.toString()}?line=${n - 1}'>${n}</a>${suffix}`;
            });

            return !inputMatch
                ? afterLineReplace
                : // Then replace the input line with our uri for this cell
                  afterLineReplace.replace(
                      /.*?\n/,
                      `\u001b[1;32m${DataScience.cellAtFormat().format(
                          getFilePath(cell.document.uri),
                          (cell.index + 1).toString()
                      )}\u001b[0m in \u001b[0;36m${inputMatch[2]}\n`
                  );
        });
    }
}
