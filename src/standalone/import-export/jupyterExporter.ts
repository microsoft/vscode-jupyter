// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable, optional } from 'inversify';

import { NotebookData, Uri, extensions, window, type NotebookCellData } from 'vscode';
import { traceError } from '../../platform/logging';
import { IFileSystem } from '../../platform/common/platform/types';
import { DataScience } from '../../platform/common/utils/localize';
import { defaultNotebookFormat } from '../../platform/common/constants';
import { IJupyterServerHelper, INotebookExporter } from '../../kernels/jupyter/types';
import { openAndShowNotebook } from '../../platform/common/utils/notebooks';
import { noop } from '../../platform/common/utils/misc';
import { IDataScienceErrorHandler } from '../../kernels/errors/types';
import { getVersion } from '../../platform/interpreter/helpers';

/**
 * Provides export for the interactive window
 */
@injectable()
export class JupyterExporter implements INotebookExporter {
    constructor(
        @inject(IJupyterServerHelper) @optional() private jupyterServerHelper: IJupyterServerHelper | undefined,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IDataScienceErrorHandler) protected errorHandler: IDataScienceErrorHandler
    ) {}

    public async exportToFile(cells: NotebookCellData[], file: string, showOpenPrompt: boolean = true): Promise<void> {
        const contents = await this.serialize(cells);

        try {
            await this.fileSystem.writeFile(Uri.file(file), contents || '');
            if (!showOpenPrompt) {
                return;
            }
            const openQuestion1 = DataScience.exportOpenQuestion1;
            window
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
            window
                .showInformationMessage(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    DataScience.exportDialogFailed(exc as any)
                )
                .then(noop, noop);
        }
    }
    async serialize(cells: NotebookCellData[], kernelSpec?: nbformat.IKernelspecMetadata): Promise<string | undefined> {
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            kernelspec: kernelSpec as any
        };

        type IPynbApi = {
            exportNotebook: (notebook: NotebookData) => string;
        };
        const ipynbMain = extensions.getExtension<IPynbApi>('vscode.ipynb')?.exports;
        if (!ipynbMain) {
            throw new Error('vscode.ipynb extension not found');
        }
        const notebook = new NotebookData(cells);
        notebook.metadata = {
            custom: {
                metadata,
                nbformat: defaultNotebookFormat.major,
                nbformat_minor: defaultNotebookFormat.minor
            }
        };
        return ipynbMain.exportNotebook(notebook);
    }
    private extractPythonMainVersion = async (): Promise<number> => {
        if (!this.jupyterServerHelper) {
            return 3;
        }
        // Use the active interpreter
        const usableInterpreter = await this.jupyterServerHelper.getUsableJupyterPython();
        const version = await getVersion(usableInterpreter);
        return (usableInterpreter && version && version.major) || 3;
    };
}
