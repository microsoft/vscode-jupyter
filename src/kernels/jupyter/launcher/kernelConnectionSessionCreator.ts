// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import {
    GetServerOptions,
    IKernelConnectionSession,
    IKernelConnectionSessionCreator,
    isLocalConnection,
    NotebookCreationOptions
} from '../../types';
import { Cancellation } from '../../../platform/common/cancellation';
import { IRawKernelConnectionSessionCreator } from '../../raw/types';
import { IJupyterNotebookProvider } from '../types';

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class KernelConnectionSessionCreator implements IKernelConnectionSessionCreator {
    constructor(
        @inject(IRawKernelConnectionSessionCreator)
        @optional()
        private readonly rawKernelSessionCreator: IRawKernelConnectionSessionCreator | undefined,
        @inject(IJupyterNotebookProvider)
        private readonly jupyterNotebookProvider: IJupyterNotebookProvider
    ) {}

    public async create(options: NotebookCreationOptions): Promise<IKernelConnectionSession> {
        const kernelConnection = options.kernelConnection;
        const isLocal = isLocalConnection(kernelConnection);

        if (this.rawKernelSessionCreator?.isSupported && isLocal) {
            return this.rawKernelSessionCreator.create(
                options.resource,
                options.kernelConnection,
                options.ui,
                options.token
            );
        }
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
        Cancellation.throwIfCanceled(options.token);

        return this.jupyterNotebookProvider.createNotebook(options);
    }
}
