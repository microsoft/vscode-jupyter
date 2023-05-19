// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { ConnectNotebookProviderOptions, IJupyterConnection, IJupyterServerConnector } from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IJupyterServerProvider } from '../types';
import { PythonExtensionNotInstalledError } from '../../../platform/errors/pythonExtNotInstalledError';

@injectable()
export class JupyterServerConnector implements IJupyterServerConnector {
    private readonly startupUi = new DisplayOptions(true);
    constructor(
        @inject(IJupyterServerProvider)
        private readonly jupyterServerProvider: IJupyterServerProvider,
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
        if (this.extensionChecker.isPythonExtensionInstalled) {
            return this.jupyterServerProvider.getOrStartServer(options).finally(() => handler.dispose());
        } else {
            handler.dispose();
            if (!this.startupUi.disableUI) {
                await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
            }
            throw new PythonExtensionNotInstalledError();
        }
    }
}
