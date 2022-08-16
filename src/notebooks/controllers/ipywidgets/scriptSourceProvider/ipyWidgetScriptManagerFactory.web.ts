// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { IFileSystem } from '../../../../platform/common/platform/types';
import { IExtensionContext, IHttpClient } from '../../../../platform/common/types';
import { IKernel } from '../../../../kernels/types';
import { RemoteIPyWidgetScriptManager } from './remoteIPyWidgetScriptManager';
import { IIPyWidgetScriptManager, IIPyWidgetScriptManagerFactory } from '../types';

/**
 * Determines the IPyWidgetScriptManager for use in a web environment
 */
@injectable()
export class IPyWidgetScriptManagerFactory implements IIPyWidgetScriptManagerFactory {
    private readonly managers = new WeakMap<IKernel, IIPyWidgetScriptManager>();
    constructor(
        @inject(IHttpClient) private readonly httpClient: IHttpClient,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    getOrCreate(kernel: IKernel): IIPyWidgetScriptManager {
        if (!this.managers.has(kernel)) {
            if (
                kernel.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingRemoteKernelSpec'
            ) {
                this.managers.set(
                    kernel,
                    new RemoteIPyWidgetScriptManager(kernel, this.httpClient, this.context, this.fs)
                );
            } else {
                throw new Error('Cannot enumerate Widget Scripts using local kernels on the Web');
            }
        }
        return this.managers.get(kernel)!;
    }
}
