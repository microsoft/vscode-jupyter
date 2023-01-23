// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';

import { Uri } from 'vscode';
import { CellMatcher } from '../../interactive-window/editor-integration/cellMatcher';
import { IApplicationShell } from '../../platform/common/application/types';
import { traceError } from '../../platform/logging';
import { IFileSystem } from '../../platform/common/platform/types';
import { ICell, IConfigurationService } from '../../platform/common/types';
import { pruneCell } from '../../platform/common/utils';
import { DataScience } from '../../platform/common/utils/localize';
import { defaultNotebookFormat } from '../../platform/common/constants';
import { INotebookExporter, IJupyterExecution } from '../../kernels/jupyter/types';
import { openAndShowNotebook } from '../../platform/common/utils/notebooks';
import { noop } from '../../platform/common/utils/misc';
import { IDataScienceErrorHandler } from '../../kernels/errors/types';

/**
 * Provides export for the interactive window
 */
@injectable()
export class JupyterExporter implements INotebookExporter {
    constructor(
        @inject(IJupyterExecution) private jupyterExecution: IJupyterExecution,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IDataScienceErrorHandler) protected errorHandler: IDataScienceErrorHandler
    ) {}

    public dispose() {
        // Do nothing
    }

    public async exportToFile(cells: ICell[], file: string, showOpenPrompt: boolean = true): Promise<void> {
        const notebook = await this.translateToNotebook(cells);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const contents = JSON.stringify(notebook, undefined, 1);
            await this.fileSystem.writeFile(Uri.file(file), contents);
            if (!showOpenPrompt) {
                return;
            }
            const openQuestion1 = DataScience.exportOpenQuestion1;
            this.applicationShell
                .showInformationMessage(DataScience.exportDialogComplete(file), openQuestion1)
                .then(async (str: string | undefined) => {
                    try {
                        if (str === openQuestion1) {
                            await openAndShowNotebook(Uri.file(file));
                        }
                    } catch (e) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        await this.errorHandler.handleError(e as any);
                    }
                }, noop);
        } catch (exc) {
            traceError('Error in exporting notebook file');
            this.applicationShell
                .showInformationMessage(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    DataScience.exportDialogFailed(exc as any)
                )
                .then(noop, noop);
        }
    }
    public async translateToNotebook(
        cells: ICell[],
        kernelSpec?: nbformat.IKernelspecMetadata
    ): Promise<nbformat.INotebookContent | undefined> {
        const pythonNumber = await this.extractPythonMainVersion();

        // Use this to build our metadata object
        const metadata = {
            language_info: {
                codemirror_mode: {
                    name: 'ipython',
                    version: pythonNumber
                },
                file_extension: '.py',
                mimetype: 'text/x-python',
                name: 'python',
                nbconvert_exporter: 'python',
                pygments_lexer: `ipython${pythonNumber}`,
                version: pythonNumber
            },
            orig_nbformat: defaultNotebookFormat.major,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            kernelspec: kernelSpec as any
        };

        // Create an object for matching cell definitions
        const matcher = new CellMatcher(this.configService.getSettings());

        // Combine this into a JSON object
        return {
            cells: this.pruneCells(cells, matcher),
            nbformat: defaultNotebookFormat.major,
            nbformat_minor: defaultNotebookFormat.minor,
            metadata: metadata
        };
    }

    private pruneCells = (cells: ICell[], cellMatcher: CellMatcher): nbformat.IBaseCell[] => {
        // First filter out sys info cells. Jupyter doesn't understand these
        const filtered = cells;

        // Then prune each cell down to just the cell data.
        return filtered.map((c) => this.pruneCell(c, cellMatcher));
    };

    private pruneCell = (cell: ICell, cellMatcher: CellMatcher): nbformat.IBaseCell => {
        // Prune with the common pruning function first.
        const copy = pruneCell({ ...cell.data });

        // Remove the #%% of the top of the source if there is any. We don't need
        // this to end up in the exported ipynb file.
        copy.source = this.pruneSource(cell.data.source, cellMatcher);
        return copy;
    };

    private pruneSource = (source: nbformat.MultilineString, cellMatcher: CellMatcher): nbformat.MultilineString => {
        // Remove the comments on the top if there.
        if (Array.isArray(source) && source.length > 0) {
            if (cellMatcher.isCell(source[0])) {
                return source.slice(1);
            }
        } else {
            const array = source
                .toString()
                .split('\n')
                .map((s) => `${s}\n`);
            if (array.length > 0 && cellMatcher.isCell(array[0])) {
                return array.slice(1);
            }
        }

        return source;
    };

    private extractPythonMainVersion = async (): Promise<number> => {
        // Use the active interpreter
        const usableInterpreter = await this.jupyterExecution.getUsableJupyterPython();
        return usableInterpreter && usableInterpreter.version ? usableInterpreter.version.major : 3;
    };
}
