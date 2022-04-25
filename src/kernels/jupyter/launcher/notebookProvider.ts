// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, optional } from 'inversify';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IConfigurationService } from '../../../platform/common/types';
import { trackKernelResourceInformation, sendKernelTelemetryWhenDone } from '../../../telemetry/telemetry';
import { Telemetry } from '../../../webviews/webview-side/common/constants';
import {
    ConnectNotebookProviderOptions,
    INotebook,
    INotebookProvider,
    INotebookProviderConnection,
    isLocalConnection,
    NotebookCreationOptions
} from '../../types';
import { Cancellation } from '../../../platform/common/cancellation';
import { Settings } from '../../../platform/common/constants';
import { DisplayOptions } from '../../displayOptions';
import { IRawNotebookProvider } from '../../raw/types';
import { IJupyterNotebookProvider } from '../types';

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
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

    // Attempt to connect to our server provider, and if we do, return the connection info
    public async connect(options: ConnectNotebookProviderOptions): Promise<INotebookProviderConnection> {
        const settings = this.configService.getSettings(undefined);
        const serverType: string | undefined = settings.jupyterServerType;
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
        if (this.rawNotebookProvider?.isSupported && options.kind === 'localJupyter') {
            throw new Error('Connect method should not be invoked for local Connections when Raw is supported');
        } else if (
            this.extensionChecker.isPythonExtensionInstalled ||
            serverType === Settings.JupyterServerRemoteLaunch
        ) {
            return this.jupyterNotebookProvider.connect(options).finally(() => handler.dispose());
        } else {
            handler.dispose();
            await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
            throw new Error('Python extension is not installed');
        }
    }
    public async createNotebook(options: NotebookCreationOptions): Promise<INotebook> {
        const isLocal = isLocalConnection(options.kernelConnection);
        const rawLocalKernel = this.rawNotebookProvider?.isSupported && isLocal;

        // We want to cache a Promise<INotebook> from the create functions
        // but jupyterNotebookProvider.createNotebook can be undefined if the server is not available
        // so check for our connection here first
        if (!rawLocalKernel) {
            await this.jupyterNotebookProvider.connect({
                resource: options.resource,
                token: options.token,
                ui: options.ui,
                kind: isLocal ? 'localJupyter' : 'remoteJupyter'
            });
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
