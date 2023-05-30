// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-use-before-define */

import { inject, injectable } from 'inversify';
import { IJupyterServerUriStorage, JupyterServerProviderHandle } from '../types';
import { JupyterConnection } from './jupyterConnection';
import { traceError } from '../../../platform/logging';

export type SelectJupyterUriCommandSource =
    | 'nonUser'
    | 'toolbar'
    | 'commandPalette'
    | 'nativeNotebookStatusBar'
    | 'nativeNotebookToolbar'
    | 'errorHandler'
    | 'prompt';

/**
 * Provides the UI for picking a remote server. Multiplexes to one of two implementations based on the 'showOnlyOneTypeOfKernel' experiment.
 */
@injectable()
export class JupyterServerSelector {
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection
    ) {}

    public async addJupyterServer(serverHandle: JupyterServerProviderHandle): Promise<void> {
        try {
            // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
            await this.jupyterConnection.validateJupyterServer(serverHandle);
        } catch (err) {
            traceError(`Error in validating the Remote Uri ${serverHandle.id}.${serverHandle.handle}`, err);
            return;
        }
        await this.serverUriStorage.add(serverHandle);
    }
}
