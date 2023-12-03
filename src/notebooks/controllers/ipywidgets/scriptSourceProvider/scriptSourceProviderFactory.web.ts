// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { GLOBAL_MEMENTO, IConfigurationService, IMemento } from '../../../../platform/common/types';
import { IKernel } from '../../../../kernels/types';
import { CDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider';
import { RemoteWidgetScriptSourceProvider } from './remoteWidgetScriptSourceProvider';
import {
    IIPyWidgetScriptManagerFactory,
    ILocalResourceUriConverter,
    IWidgetScriptSourceProvider,
    IWidgetScriptSourceProviderFactory
} from '../types';

/**
 * Determines the IWidgetScriptSourceProvider for use in a web environment
 */
@injectable()
export class ScriptSourceProviderFactory implements IWidgetScriptSourceProviderFactory {
    constructor(
        @inject(IConfigurationService) private readonly configurationSettings: IConfigurationService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IIPyWidgetScriptManagerFactory)
        private readonly widgetScriptManagerFactory: IIPyWidgetScriptManagerFactory
    ) {}

    public getProviders(kernel: IKernel, _uriConverter: ILocalResourceUriConverter) {
        const scriptProviders: IWidgetScriptSourceProvider[] = [];

        // Give preference to CDN.
        scriptProviders.push(new CDNWidgetScriptSourceProvider(this.globalMemento, this.configurationSettings));

        // Only remote is supported at the moment
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec':
                scriptProviders.push(new RemoteWidgetScriptSourceProvider(kernel, this.widgetScriptManagerFactory));
                break;
        }

        return scriptProviders;
    }
}
