// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { traceError, traceInfo, traceVerbose } from '../../platform/logging';
import { IConfigurationService, IHttpClient, WidgetCDNs } from '../../platform/common/types';
import { WidgetScriptSource } from './types';
import { ConsoleForegroundColors } from '../../platform/logging/types';
import { BaseCDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider.base';

/**
 * Widget scripts are found in CDN.
 * Given an widget module name & version, this will attempt to find the Url on a CDN.
 * We'll need to stick to the order of preference prescribed by the user.
 */
export class CDNWidgetScriptSourceProvider extends BaseCDNWidgetScriptSourceProvider {
    constructor(configurationSettings: IConfigurationService, private readonly httpClient: IHttpClient) {
        super(configurationSettings);
    }
    protected async getWidgetScriptSourceImplementation(
        moduleName: string,
        moduleVersion: string
    ): Promise<WidgetScriptSource> {
        traceInfo(
            `${
                ConsoleForegroundColors.Green
            }Searching for Widget Script ${moduleName}#${moduleVersion} using cdns ${this.cdnProviders.join(' ')}`
        );
        // Try all cdns
        const uris = await Promise.all(
            this.cdnProviders.map((cdn) => this.getValidUri(moduleName, moduleVersion, cdn))
        );
        const scriptUri = uris.find((u) => u);
        if (scriptUri) {
            traceInfo(
                `${ConsoleForegroundColors.Green}Widget Script ${moduleName}#${moduleVersion} found at URI: ${scriptUri}`
            );
            return { moduleName, scriptUri, source: 'cdn' };
        }

        traceError(`Widget Script ${moduleName}#${moduleVersion} was not found on on any cdn`);
        return { moduleName };
    }

    private async getValidUri(moduleName: string, moduleVersion: string, cdn: WidgetCDNs): Promise<string | undefined> {
        // Make sure CDN has the item before returning it.
        try {
            const downloadUrl = await this.generateDownloadUri(moduleName, moduleVersion, cdn);
            if (downloadUrl && (await this.httpClient.exists(downloadUrl))) {
                return downloadUrl;
            }
        } catch (ex) {
            traceVerbose(`Failed downloading ${moduleName}:${moduleVersion} from ${cdn}`);
            return undefined;
        }
    }
}
