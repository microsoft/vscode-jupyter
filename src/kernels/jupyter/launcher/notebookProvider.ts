// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, optional } from 'inversify';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import {
    ConnectNotebookProviderOptions,
    GetServerOptions,
    IKernelConnectionSession,
    INotebookProvider,
    INotebookProviderConnection,
    isLocalConnection,
    NotebookCreationOptions
} from '../../types';
import { Cancellation } from '../../../platform/common/cancellation';
import { DisplayOptions } from '../../displayOptions';
import { IRawNotebookProvider } from '../../raw/types';
import { IJupyterNotebookProvider, IServerConnectionType } from '../types';

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class NotebookProvider implements INotebookProvider {
    private readonly startupUi = new DisplayOptions(true);
    constructor(
        @inject(IRawNotebookProvider)
        @optional()
        private readonly rawNotebookProvider: IRawNotebookProvider | undefined,
        @inject(IJupyterNotebookProvider)
        private readonly jupyterNotebookProvider: IJupyterNotebookProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IServerConnectionType) private readonly serverConnectionType: IServerConnectionType
    ) {}

    // Attempt to connect to our server provider, and if we do, return the connection info
    public async connect(options: ConnectNotebookProviderOptions): Promise<INotebookProviderConnection> {
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
        } else if (this.extensionChecker.isPythonExtensionInstalled || !this.serverConnectionType.isLocalLaunch) {
            return this.jupyterNotebookProvider.connect(options).finally(() => handler.dispose());
        } else {
            handler.dispose();
            if (!this.startupUi.disableUI) {
                await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
            }
            throw new Error('Python Extension is not installed');
        }
    }
    public async create(options: NotebookCreationOptions): Promise<IKernelConnectionSession> {
        const kernelConnection = options.kernelConnection;
        const isLocal = isLocalConnection(kernelConnection);
        const rawLocalKernel = this.rawNotebookProvider?.isSupported && isLocal;

        // We want to cache a Promise<INotebook> from the create functions
        // but jupyterNotebookProvider.createNotebook can be undefined if the server is not available
        // so check for our connection here first
        if (!rawLocalKernel) {
            const serverOptions: GetServerOptions = isLocal
                ? {
                      resource: options.resource,
                      token: options.token,
                      ui: options.ui,
                      localJupyter: true
                  }
                : {
                      resource: options.resource,
                      token: options.token,
                      ui: options.ui,
                      localJupyter: false,
                      serverId: kernelConnection.serverId
                  };
            await this.jupyterNotebookProvider.connect(serverOptions);
        }
        Cancellation.throwIfCanceled(options.token);
        return rawLocalKernel
            ? this.rawNotebookProvider!.createNotebook(
                  options.resource,
                  options.kernelConnection,
                  options.ui,
                  options.token
              )
            : this.jupyterNotebookProvider.createNotebook(options);
    }
}
