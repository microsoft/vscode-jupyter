// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IPythonExtensionChecker } from '../../api/types';
import { IConfigurationService } from '../../common/types';
import { Settings, Telemetry } from '../constants';
import { sendKernelTelemetryWhenDone, trackKernelResourceInformation } from '../telemetry/telemetry';
import {
    ConnectNotebookProviderOptions,
    NotebookCreationOptions,
    IJupyterNotebookProvider,
    INotebook,
    INotebookProvider,
    INotebookProviderConnection,
    IRawNotebookProvider
} from '../types';

@injectable()
export class NotebookProvider implements INotebookProvider {
    constructor(
        @inject(IRawNotebookProvider) private readonly rawNotebookProvider: IRawNotebookProvider,
        @inject(IJupyterNotebookProvider) private readonly jupyterNotebookProvider: IJupyterNotebookProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

    // Attempt to connect to our server provider, and if we do, return the connection info
    public async connect(options: ConnectNotebookProviderOptions): Promise<INotebookProviderConnection | undefined> {
        const settings = this.configService.getSettings(undefined);
        const serverType: string | undefined = settings.jupyterServerType;

        // Connect to either a jupyter server or a stubbed out raw notebook "connection"
        if (this.rawNotebookProvider.isSupported) {
            return this.rawNotebookProvider.connect({
                ...options
            });
        } else if (
            this.extensionChecker.isPythonExtensionInstalled ||
            serverType === Settings.JupyterServerRemoteLaunch
        ) {
            return this.jupyterNotebookProvider.connect({
                ...options
            });
        } else if (!options.getOnly) {
            await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }
    }
    public async createNotebook(options: NotebookCreationOptions): Promise<INotebook | undefined> {
        const rawKernel = this.rawNotebookProvider.isSupported;

        // We want to cache a Promise<INotebook> from the create functions
        // but jupyterNotebookProvider.createNotebook can be undefined if the server is not available
        // so check for our connection here first
        if (!rawKernel) {
            if (!(await this.jupyterNotebookProvider.connect(options))) {
                return undefined;
            }
        }

        trackKernelResourceInformation(options.resource, { kernelConnection: options.kernelConnection });
        const promise = rawKernel
            ? this.rawNotebookProvider.createNotebook(
                  options.document,
                  options.resource,
                  options.kernelConnection,
                  options.ui,
                  options.token
              )
            : this.jupyterNotebookProvider.createNotebook(options);

        sendKernelTelemetryWhenDone(options.resource, Telemetry.NotebookStart, promise, undefined, {
            disableUI: options.ui.disableUI === true
        });

        return promise;
    }
}
