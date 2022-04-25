// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable, named } from 'inversify';
import { Uri } from 'vscode';
import { _WindowMiddleware } from 'vscode-languageclient';
import { IInteractiveWindowProvider } from '../interactive-window/types';
import { findAssociatedNotebookDocument } from '../notebooks/helpers';
import { INotebookControllerManager } from '../notebooks/types';
import { IExtensionSingleActivationService } from '../platform/activation/types';
import { IPythonApiProvider } from '../platform/api/types';
import { IVSCodeNotebook } from '../platform/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../platform/common/constants';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { IConfigurationService, IOutputChannel } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';

@injectable()
export class NotebookPythonPathService implements IExtensionSingleActivationService {
    private _isEnabled: boolean | undefined;

    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {
        this.output.appendLine(`NotebookPythonPathService: constructor`);
    }

    public async isEnabled() {
        if (this._isEnabled === undefined) {
           if (!this.configService.getSettings().pylanceLspNotebooksEnabled) {
               this._isEnabled = false;
           }
           else {
                this._isEnabled = await this.apiProvider.getApi().then((api) => {
                    // Python extension may not have been updated to support the register API yet.
                    return api.registerJupyterPythonPathFunction !== undefined;
                });
           }
        }

        return this._isEnabled;
    }

    public async activate() {
        this.output.appendLine(`NotebookPythonPathService: activate`);
        if (!await this.isEnabled()) {
            return;
        }

        await this.apiProvider.getApi().then((api) => {
            api.registerJupyterPythonPathFunction(this.jupyterPythonPathFunction)
        });
    }

    private async jupyterPythonPathFunction(uri: Uri): Promise<string | undefined> {
        this.output.appendLine(`NotebookPythonPathService: jupyterPythonPathFunction: ${uri.toString()}`);
        const notebook = findAssociatedNotebookDocument(uri, this.notebooks, this.interactiveWindowProvider);
        const controller = notebook
            ? this.notebookControllerManager.getSelectedNotebookController(notebook)
            : undefined;

        const interpreter = controller ? controller.connection.interpreter : await this.interpreterService.getActiveInterpreter(uri);
        if (!interpreter){return undefined;}

        const pythonPath = getFilePath(interpreter.uri);
        return pythonPath;
    }
}
