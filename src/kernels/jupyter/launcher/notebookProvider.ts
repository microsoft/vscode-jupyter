// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, optional } from 'inversify';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { trackKernelResourceInformation, sendKernelTelemetryWhenDone } from '../../../telemetry/telemetry';
import { Telemetry } from '../../../webviews/webview-side/common/constants';
import {
    ConnectNotebookProviderOptions,
    GetServerOptions,
    IJupyterSession,
    INotebookProvider,
    INotebookProviderConnection,
    isLocalConnection,
    NotebookCreationOptions
} from '../../types';
import { Cancellation } from '../../../platform/common/cancellation';
import { DisplayOptions } from '../../displayOptions';
import { IRawNotebookProvider } from '../../raw/types';
import { IJupyterNotebookProvider } from '../types';
import { ServerConnectionType } from './serverConnectionType';

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
        @inject(ServerConnectionType) private readonly serverConnectionType: ServerConnectionType
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
            throw new Error('Python extension is not installed');
        }
    }
    public async create(options: NotebookCreationOptions): Promise<IJupyterSession> {
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
        trackKernelResourceInformation(options.resource, { kernelConnection: options.kernelConnection });
        const promise = rawLocalKernel
            ? this.rawNotebookProvider!.createNotebook(
                  options.resource,
                  options.kernelConnection,
                  options.ui,
                  options.token
              )
            : this.jupyterNotebookProvider.createNotebook(options);

        sendKernelTelemetryWhenDone(
            options.resource,
            Telemetry.NotebookStart,
            promise || Promise.resolve(undefined),
            undefined,
            {
                disableUI: options.ui.disableUI === true
            }
        );

        return promise;
    }
}
