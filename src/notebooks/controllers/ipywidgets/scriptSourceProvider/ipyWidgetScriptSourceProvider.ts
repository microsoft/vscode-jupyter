// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import '../../../../platform/common/extensions';
import { traceError, traceInfo } from '../../../../platform/logging';
import { WidgetCDNs, IConfigurationService, IHttpClient } from '../../../../platform/common/types';
import { sendTelemetryEvent, Telemetry } from '../../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../../platform/telemetry/helpers';
import { IKernel } from '../../../../kernels/types';
import {
    ILocalResourceUriConverter,
    IWidgetScriptSourceProvider,
    IWidgetScriptSourceProviderFactory,
    WidgetScriptSource
} from '../types';

/**
 * This class decides where to get widget scripts from.
 * Whether its cdn or local or other, and also controls the order/priority.
 * If user changes the order, this will react to those configuration setting changes.
 * If user has not configured antying, user will be presented with a prompt.
 */
export class IPyWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    private readonly scriptProviders: IWidgetScriptSourceProvider[];
    private get configuredScriptSources(): readonly WidgetCDNs[] {
        const settings = this.configurationSettings.getSettings(undefined);
        return settings.widgetScriptSources;
    }
    constructor(
        private readonly kernel: IKernel,
        private readonly localResourceUriConverter: ILocalResourceUriConverter,
        private readonly configurationSettings: IConfigurationService,
        private readonly httpClient: IHttpClient,
        private readonly sourceProviderFactory: IWidgetScriptSourceProviderFactory,
        private readonly isWebViewOnline: Promise<boolean>
    ) {
        this.scriptProviders = this.sourceProviderFactory.getProviders(
            this.kernel,
            this.localResourceUriConverter,
            this.httpClient
        );
    }
    public dispose() {
        this.disposeScriptProviders();
    }
    public async getBaseUrl() {
        const provider = this.scriptProviders.find((item) => item.getBaseUrl);
        if (!provider) {
            return;
        }

        return provider.getBaseUrl!();
    }
    public async getWidgetScriptSources() {
        const sources: WidgetScriptSource[] = [];
        await Promise.all(
            this.scriptProviders.map(async (item) => {
                if (item.getWidgetScriptSources) {
                    sources.push(...(await item.getWidgetScriptSources()));
                }
            })
        );
        return sources;
    }
    /**
     * We know widgets are being used, at this point prompt user if required.
     */
    public async getWidgetScriptSource(
        moduleName: string,
        moduleVersion: string
    ): Promise<Readonly<WidgetScriptSource>> {
        const isWebViewOnline = await this.isWebViewOnline;

        // Get script sources in order, if one works, then get out.
        const scriptSourceProviders = (this.scriptProviders || []).slice();
        let found: WidgetScriptSource = { moduleName };
        while (scriptSourceProviders.length) {
            const scriptProvider = scriptSourceProviders.shift();
            if (!scriptProvider) {
                continue;
            }
            const source = await scriptProvider.getWidgetScriptSource(moduleName, moduleVersion, isWebViewOnline);
            // If we found the script source, then use that.
            if (source.scriptUri) {
                found = source;
                break;
            }
        }

        sendTelemetryEvent(Telemetry.HashedIPyWidgetNameUsed, undefined, {
            hashedName: getTelemetrySafeHashedString(found.moduleName),
            source: found.source,
            cdnSearched: this.configuredScriptSources.length > 0
        });

        if (!found.scriptUri) {
            traceError(`Script source for Widget ${moduleName}@${moduleVersion} not found`);
        } else {
            traceInfo(`Script source for Widget ${moduleName}@${moduleVersion} was found from source ${found.source}`);
        }
        return found;
    }
    private disposeScriptProviders() {
        while (this.scriptProviders && this.scriptProviders.length) {
            const item = this.scriptProviders.shift();
            if (item) {
                item.dispose();
            }
        }
    }
}
