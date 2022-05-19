// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { IPythonExecutionFactory } from '../../platform/common/process/types.node';
import { IConfigurationService, IHttpClient, WidgetCDNs } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { IKernel } from '../types';
import { CDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider.node';
import { LocalWidgetScriptSourceProvider } from './localWidgetScriptSourceProvider.node';
import { RemoteWidgetScriptSourceProvider } from './remoteWidgetScriptSourceProvider';
import { ILocalResourceUriConverter, IWidgetScriptSourceProvider, IWidgetScriptSourceProviderFactory } from './types';

@injectable()
export class ScriptSourceProviderFactory implements IWidgetScriptSourceProviderFactory {
    private get configuredScriptSources(): readonly WidgetCDNs[] {
        const settings = this.configurationSettings.getSettings(undefined);
        return settings.widgetScriptSources;
    }

    constructor(
        @inject(IConfigurationService) private readonly configurationSettings: IConfigurationService,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPythonExecutionFactory) private readonly factory: IPythonExecutionFactory
    ) {}

    public getProviders(kernel: IKernel, uriConverter: ILocalResourceUriConverter, httpClient: IHttpClient) {
        const scriptProviders: IWidgetScriptSourceProvider[] = [];

        // If we're allowed to use CDN providers, then use them, and use in order of preference.
        if (this.configuredScriptSources.length > 0) {
            scriptProviders.push(
                new CDNWidgetScriptSourceProvider(this.configurationSettings, uriConverter, this.fs, httpClient)
            );
        }
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec':
                scriptProviders.push(new RemoteWidgetScriptSourceProvider(kernel.kernelConnectionMetadata.baseUrl));
                break;

            default:
                scriptProviders.push(
                    new LocalWidgetScriptSourceProvider(
                        kernel,
                        uriConverter,
                        this.fs,
                        this.interpreterService,
                        this.factory
                    )
                );
        }

        return scriptProviders;
    }
}
