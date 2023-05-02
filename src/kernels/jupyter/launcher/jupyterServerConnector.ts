// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { ConnectNotebookProviderOptions, IJupyterConnection, IJupyterServerConnector } from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IRawKernelConnectionSessionCreator } from '../../raw/types';
import { IJupyterNotebookProvider } from '../types';
import { PythonExtensionNotInstalledError } from '../../../platform/errors/pythonExtNotInstalledError';

@injectable()
export class JupyterServerConnector implements IJupyterServerConnector {
    private readonly startupUi = new DisplayOptions(true);
    constructor(
        @inject(IRawKernelConnectionSessionCreator)
        @optional()
        private readonly rawNotebookProvider: IRawKernelConnectionSessionCreator | undefined,
        @inject(IJupyterNotebookProvider)
        private readonly jupyterNotebookProvider: IJupyterNotebookProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}

    public async connect(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection> {
        if (!options.ui.disableUI) {
            this.startupUi.disableUI = false;
        }
        const handler = options.ui.onDidChangeDisableUI(() => {
            if (!options.ui.disableUI) {
                this.startupUi.disableUI = false;
                handler.dispose();
            }
        });
        options.ui = this.startupUi;
        if (this.rawNotebookProvider?.isSupported && options.localJupyter) {
            throw new Error('Connect method should not be invoked for local Connections when Raw is supported');
        } else if (this.extensionChecker.isPythonExtensionInstalled || !options.localJupyter) {
            return this.jupyterNotebookProvider.connect(options).finally(() => handler.dispose());
        } else {
            handler.dispose();
            if (!this.startupUi.disableUI && options.localJupyter) {
                await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
            }
            throw new PythonExtensionNotInstalledError();
        }
    }
}
