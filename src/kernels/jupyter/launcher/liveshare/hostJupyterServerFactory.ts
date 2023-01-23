// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import {} from 'underscore';
import { IWorkspaceService } from '../../../../platform/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../../../platform/common/constants';
import { IAsyncDisposableRegistry, IDisposableRegistry, IOutputChannel } from '../../../../platform/common/types';
import { DataScience } from '../../../../platform/common/utils/localize';
import { traceInfo } from '../../../../platform/logging';
import { IJupyterConnection } from '../../../types';
import { JupyterSessionManager } from '../../session/jupyterSessionManager';
import { IJupyterSessionManagerFactory, INotebookServer, INotebookServerFactory } from '../../types';
import { HostJupyterServer } from './hostJupyterServer';

/**
 * Factory for HostJupyterServer.
 */
@injectable()
export class HostJupyterServerFactory implements INotebookServerFactory {
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IJupyterSessionManagerFactory) private readonly sessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly jupyterOutputChannel: IOutputChannel,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public async createNotebookServer(connection: IJupyterConnection): Promise<INotebookServer> {
        traceInfo(`Connecting server kernel ${connection.baseUrl}`);

        // Indicate we have a new session on the output channel
        if (!connection.localLaunch) {
            this.jupyterOutputChannel.appendLine(DataScience.connectingToJupyterUri(connection.baseUrl));
        }
        // Create our session manager
        const sessionManager = (await this.sessionManagerFactory.create(connection)) as JupyterSessionManager;
        // Create a server tha  t we will then attempt to connect to.
        return new HostJupyterServer(
            this.asyncRegistry,
            this.workspaceService,
            this.jupyterOutputChannel,
            this.disposables,
            connection,
            sessionManager
        );
    }
}
