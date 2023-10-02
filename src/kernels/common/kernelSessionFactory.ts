// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IKernelSession, IKernelSessionFactory, isLocalConnection, KernelSessionCreationOptions } from '../types';
import { IRawKernelSessionFactory, IRawNotebookSupportedService } from '../raw/types';
import { JupyterKernelSessionFactory } from '../jupyter/session/jupyterKernelSessionFactory';

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class KernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IRawNotebookSupportedService)
        private readonly rawKernelSupported: IRawNotebookSupportedService,

        @inject(IRawKernelSessionFactory)
        @optional()
        private readonly newRawKernelSessionFactory: IRawKernelSessionFactory | undefined,
        @inject(JupyterKernelSessionFactory)
        private readonly newJupyterSessionFactory: IKernelSessionFactory
    ) {}

    public async create(options: KernelSessionCreationOptions): Promise<IKernelSession> {
        const kernelConnection = options.kernelConnection;
        if (
            this.rawKernelSupported.isSupported &&
            isLocalConnection(kernelConnection) &&
            this.newRawKernelSessionFactory
        ) {
            return this.newRawKernelSessionFactory.create({ ...options, kernelConnection: kernelConnection });
        } else {
            return this.newJupyterSessionFactory.create(options);
        }
    }
}
