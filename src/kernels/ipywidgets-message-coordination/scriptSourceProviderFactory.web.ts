// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { IHttpClient } from '../../platform/common/types';
import { IKernel } from '../types';
import { RemoteWidgetScriptSourceProvider } from './remoteWidgetScriptSourceProvider';
import { ILocalResourceUriConverter, IWidgetScriptSourceProvider, IWidgetScriptSourceProviderFactory } from './types';

@injectable()
export class ScriptSourceProviderFactory implements IWidgetScriptSourceProviderFactory {
    public getProviders(
        kernel: IKernel,
        _uriConverter: ILocalResourceUriConverter,
        httpClient: IHttpClient | undefined
    ) {
        const scriptProviders: IWidgetScriptSourceProvider[] = [];

        // Only remote is supported at the moment
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec':
                if (httpClient) {
                    scriptProviders.push(
                        new RemoteWidgetScriptSourceProvider(kernel.kernelConnectionMetadata.baseUrl, httpClient)
                    );
                }
                break;
        }

        return scriptProviders;
    }
}
