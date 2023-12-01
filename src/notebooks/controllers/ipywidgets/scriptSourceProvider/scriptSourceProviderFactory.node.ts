// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { GLOBAL_MEMENTO, IConfigurationService, IMemento } from '../../../../platform/common/types';
import { IKernel } from '../../../../kernels/types';
import { LocalWidgetScriptSourceProvider } from './localWidgetScriptSourceProvider.node';
import { RemoteWidgetScriptSourceProvider } from './remoteWidgetScriptSourceProvider';
import {
    IIPyWidgetScriptManagerFactory,
    ILocalResourceUriConverter,
    IWidgetScriptSourceProvider,
    IWidgetScriptSourceProviderFactory
} from '../types';
import { IApplicationShell } from '../../../../platform/common/application/types';
import { Memento } from 'vscode';
import { CDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider';

/**
 * Returns the IWidgetScriptSourceProvider for use in a node environment
 */
@injectable()
export class ScriptSourceProviderFactory implements IWidgetScriptSourceProviderFactory {
    constructor(
        @inject(IConfigurationService) private readonly configurationSettings: IConfigurationService,
        @inject(IIPyWidgetScriptManagerFactory)
        private readonly widgetScriptManagerFactory: IIPyWidgetScriptManagerFactory,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}

    public getProviders(kernel: IKernel, uriConverter: ILocalResourceUriConverter) {
        const scriptProviders: IWidgetScriptSourceProvider[] = [];

        // Give preference to CDN.
        scriptProviders.push(
            new CDNWidgetScriptSourceProvider(this.appShell, this.globalMemento, this.configurationSettings)
        );
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec':
                scriptProviders.push(new RemoteWidgetScriptSourceProvider(kernel, this.widgetScriptManagerFactory));
                break;

            default:
                scriptProviders.push(
                    new LocalWidgetScriptSourceProvider(kernel, uriConverter, this.widgetScriptManagerFactory)
                );
        }

        return scriptProviders;
    }
}
