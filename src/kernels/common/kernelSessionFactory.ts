// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IKernelSession, IKernelSessionFactory, isLocalConnection, KernelSessionCreationOptions } from '../types';
import { IOldRawKernelSessionFactory, IRawNotebookSupportedService } from '../raw/types';
import { OldJupyterKernelSessionFactory } from '../jupyter/session/oldJupyterKernelSessionFactory';

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class KernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IRawNotebookSupportedService)
        private readonly rawKernelSupported: IRawNotebookSupportedService,

        @inject(IOldRawKernelSessionFactory)
        @optional()
        private readonly rawKernelSessionFactory: IOldRawKernelSessionFactory | undefined,
        @inject(OldJupyterKernelSessionFactory)
        private readonly jupyterSessionFactory: IKernelSessionFactory
    ) {}

    public async create(options: KernelSessionCreationOptions): Promise<IKernelSession> {
        const kernelConnection = options.kernelConnection;

        if (
            this.rawKernelSupported.isSupported &&
            isLocalConnection(kernelConnection) &&
            this.rawKernelSessionFactory
        ) {
            return this.rawKernelSessionFactory.create(options);
        } else {
            return this.jupyterSessionFactory.create(options);
        }
    }
}
