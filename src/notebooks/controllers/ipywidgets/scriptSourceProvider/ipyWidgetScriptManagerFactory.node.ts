// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { IFileSystemNode } from '../../../../platform/common/platform/types.node';
import { IDisposableRegistry, IExtensionContext, IHttpClient } from '../../../../platform/common/types';
import { IKernel } from '../../../../kernels/types';
import { IIPyWidgetScriptManager, IIPyWidgetScriptManagerFactory, INbExtensionsPathProvider } from '../types';
import { RemoteIPyWidgetScriptManager } from './remoteIPyWidgetScriptManager';
import { LocalIPyWidgetScriptManager } from './localIPyWidgetScriptManager.node';
import { JupyterPaths } from '../../../../kernels/raw/finder/jupyterPaths.node';

/**
 * Determines the IPyWidgetScriptManager for use in a node environment
 */
@injectable()
export class IPyWidgetScriptManagerFactory implements IIPyWidgetScriptManagerFactory {
    private readonly managers = new WeakMap<IKernel, IIPyWidgetScriptManager>();
    constructor(
        @inject(INbExtensionsPathProvider) private readonly nbExtensionsPathProvider: INbExtensionsPathProvider,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IHttpClient) private readonly httpClient: IHttpClient,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    getOrCreate(kernel: IKernel): IIPyWidgetScriptManager {
        if (!this.managers.has(kernel)) {
            if (
                kernel.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingRemoteKernelSpec'
            ) {
                const scriptManager = new RemoteIPyWidgetScriptManager(kernel, this.httpClient, this.context, this.fs);
                this.managers.set(kernel, scriptManager);
                kernel.onDisposed(() => scriptManager.dispose(), this, this.disposables);
            } else {
                const scriptManager = new LocalIPyWidgetScriptManager(
                    kernel,
                    this.fs,
                    this.nbExtensionsPathProvider,
                    this.context,
                    this.jupyterPaths
                );
                this.managers.set(kernel, scriptManager);
                kernel.onDisposed(() => scriptManager.dispose(), this, this.disposables);
            }
        }
        return this.managers.get(kernel)!;
    }
}
