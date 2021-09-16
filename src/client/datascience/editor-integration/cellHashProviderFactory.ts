// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, multiInject, optional } from 'inversify';
import { IDocumentManager, IDebugService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { IConfigurationService } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { IKernel, IKernelProvider } from '../jupyter/kernels/types';
import { ICellHashListener } from '../types';
import { CellHashProvider } from './cellhashprovider';

@injectable()
export class CellHashProviderFactory {
    private readonly cellHashProvidersIndexedByKernels = new WeakMap<IKernel, CellHashProvider>();
    private _kernelProvider?: IKernelProvider;
    private get kernelProvider() {
        if (!this._kernelProvider) {
            this._kernelProvider = this.svcContainer.get<IKernelProvider>(IKernelProvider);
        }
        return this._kernelProvider!;
    }

    constructor(
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IDebugService) private readonly debugService: IDebugService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IServiceContainer) private readonly svcContainer: IServiceContainer,
        @multiInject(ICellHashListener) @optional() private readonly listeners: ICellHashListener[] | undefined
    ) {}
    public get cellHashProviders() {
        const providers = new Set<CellHashProvider>();
        this.kernelProvider.kernels.forEach((item) => {
            const provider = this.get(item);
            if (provider) {
                providers.add(provider);
            }
        });
        return Array.from(providers);
    }
    public getOrCreate(kernel: IKernel): CellHashProvider {
        const existing = this.get(kernel);
        if (existing) {
            return existing;
        }
        const cellHashProvider = new CellHashProvider(
            this.documentManager,
            this.configService,
            this.debugService,
            this.fs,
            this.listeners,
            kernel
        );
        this.cellHashProvidersIndexedByKernels.set(kernel, cellHashProvider);
        return cellHashProvider;
    }
    public get(kernel: IKernel): CellHashProvider | undefined {
        return this.cellHashProvidersIndexedByKernels.get(kernel);
    }
}
