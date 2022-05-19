// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, multiInject, optional } from 'inversify';
import { IDocumentManager, IDebugService } from '../../platform/common/application/types';
import { IConfigurationService } from '../../platform/common/types';
import { IServiceContainer } from '../../platform/ioc/types';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { CellHashProvider } from './cellhashprovider';
import { ICellHashListener } from './types';
import { IPlatformService } from '../../platform/common/platform/types';
import { NotebookDocument } from 'vscode';

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
        @inject(IDebugService) @optional() private readonly debugService: IDebugService | undefined,
        @inject(IServiceContainer) private readonly svcContainer: IServiceContainer,
        @multiInject(ICellHashListener) @optional() private readonly listeners: ICellHashListener[] | undefined
    ) {}
    public get cellHashProviders() {
        const providers = new Set<CellHashProvider>();
        this.kernelProvider.kernels.forEach((item) => {
            const provider = this.cellHashProvidersIndexedByKernels.get(item);
            if (provider) {
                providers.add(provider);
            }
        });
        return Array.from(providers);
    }
    public getOrCreate(notebook: NotebookDocument): CellHashProvider {
        const existing = this.get(notebook);
        if (existing) {
            return existing;
        }
        const kernel = this.kernelProvider.get(notebook.uri);
        if (!kernel) {
            throw new Error(`No kernel associated with the document ${notebook.uri.toString()}`);
        }
        const cellHashProvider = new CellHashProvider(
            this.documentManager,
            this.configService,
            this.debugService,
            this.listeners,
            this.svcContainer.get<IPlatformService>(IPlatformService),
            kernel
        );
        this.cellHashProvidersIndexedByKernels.set(kernel, cellHashProvider);
        return cellHashProvider;
    }
    public get(notebook: NotebookDocument): CellHashProvider | undefined {
        const kernel = this.kernelProvider.get(notebook.uri);
        return kernel ? this.cellHashProvidersIndexedByKernels.get(kernel) : undefined;
    }
}
