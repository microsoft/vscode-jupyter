// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from '../../platform/common/platform/types';
import { IConfigurationService, IHttpClient, WidgetCDNs } from '../../platform/common/types';
import { IKernel } from '../types';
import { CDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider';
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
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}

    public getProviders(kernel: IKernel, uriConverter: ILocalResourceUriConverter, httpClient: IHttpClient) {
        const scriptProviders: IWidgetScriptSourceProvider[] = [];

        // If we're allowed to use CDN providers, then use them, and use in order of preference.
        if (this.configuredScriptSources.length > 0) {
            scriptProviders.push(
                new CDNWidgetScriptSourceProvider(this.configurationSettings, uriConverter, this.fs, httpClient)
            );
        }

        // Only remote is supported at the moment
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec':
                scriptProviders.push(new RemoteWidgetScriptSourceProvider(kernel.kernelConnectionMetadata.baseUrl));
                break;
        }

        return scriptProviders;
    }
}
