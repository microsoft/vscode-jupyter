// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { traceError, traceInfo } from '../../../../platform/logging';
import { WidgetCDNs, IConfigurationService, IHttpClient, IDisposable } from '../../../../platform/common/types';
import { sendTelemetryEvent, Telemetry } from '../../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../../platform/telemetry/helpers';
import { IKernel } from '../../../../kernels/types';
import {
    ILocalResourceUriConverter,
    IWidgetScriptSourceProvider,
    IWidgetScriptSourceProviderFactory,
    WidgetScriptSource
} from '../types';
import { CDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider';
import { dispose } from '../../../../platform/common/helpers';
import { Disposable } from 'vscode';
import type { IAnyMessageArgs, IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel';
import type { ICommOpenMsg } from '@jupyterlab/services/lib/kernel/messages';
import { swallowExceptions } from '../../../../platform/common/utils/decorators';
import { noop } from '../../../../platform/common/utils/misc';

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
    private readonly disposables: IDisposable[] = [];
    private static trackedWidgetModuleNames = new Set<string>();
    constructor(
        private readonly kernel: IKernel,
        private readonly localResourceUriConverter: ILocalResourceUriConverter,
        private readonly configurationSettings: IConfigurationService,
        private readonly httpClient: IHttpClient,
        private readonly sourceProviderFactory: IWidgetScriptSourceProviderFactory,
        private readonly isWebViewOnline: Promise<boolean>,
        private readonly cdnScriptProvider: CDNWidgetScriptSourceProvider
    ) {
        this.scriptProviders = this.sourceProviderFactory.getProviders(
            this.kernel,
            this.localResourceUriConverter,
            this.httpClient
        );
        this.monitorKernel();
    }
    public dispose() {
        dispose(this.disposables);
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
        this.sendTelemetryForWidgetModule(moduleName, moduleVersion, '', found.source).catch(noop);
        if (!found.scriptUri) {
            traceError(`Script source for Widget ${moduleName}@${moduleVersion} not found`);
        } else {
            traceInfo(`Script source for Widget ${moduleName}@${moduleVersion} was found from source ${found.source}`);
        }
        return found;
    }
    @swallowExceptions()
    private async sendTelemetryForWidgetModule(
        moduleName: string,
        moduleVersion: string,
        modelName: string,
        source?: 'cdn' | 'local' | 'remote'
    ) {
        const key = `${moduleName}.${moduleName}@${moduleVersion}`;
        if (IPyWidgetScriptSourceProvider.trackedWidgetModuleNames.has(key)) {
            return;
        }
        IPyWidgetScriptSourceProvider.trackedWidgetModuleNames.add(key);
        const isJupyterWidget = moduleName.toLowerCase().startsWith('@jupyter-widgets');
        const isOnCDN = source === 'cdn' || isJupyterWidget || (await this.cdnScriptProvider.isOnCDN(moduleName));
        // If the module name is found on CDN, then its not PII, its public information.
        // The telemetry reporter assumes the presence of a `/` or `\` indicates these are file paths
        // and obscures them. We don't want that, so we replace them with `_`.
        // Replace @ as these could cause telemetry module to treat them as emails.
        const telemetrySafeModuleName = isOnCDN
            ? moduleName.replace(/\//g, '_').replace(/\\/g, '_').replace(/@/g, '_at_')
            : undefined;
        // Helps us determine what widgets are being used within a particular module.
        // E.g. we can determine how popular the `Output` widget is based on this.
        // Checking the usage of `Output` and similar widgets is important as supporting `Output` widget is very complex.
        const telemetrySafeModelName = isOnCDN
            ? modelName.replace(/\//g, '_').replace(/\\/g, '_').replace(/@/g, '_at_')
            : undefined;

        sendTelemetryEvent(Telemetry.HashedIPyWidgetNameUsed, undefined, {
            hashedName: await getTelemetrySafeHashedString(moduleName),
            moduleName: telemetrySafeModuleName,
            modelName: telemetrySafeModelName,
            source: source,
            moduleVersion: isOnCDN ? moduleVersion : undefined,
            cdnSearched: this.configuredScriptSources.length > 0
        });
    }
    private disposeScriptProviders() {
        while (this.scriptProviders && this.scriptProviders.length) {
            const item = this.scriptProviders.shift();
            if (item) {
                item.dispose();
            }
        }
    }
    private monitorKernel() {
        this.hookKernelEvents();
        this.kernel.onStarted(this.hookKernelEvents, this, this.disposables);
        this.kernel.onRestarted(this.hookKernelEvents, this, this.disposables);
        this.kernel.kernelSocket(() => this.hookKernelEvents(), this, this.disposables);
    }
    private hookKernelEvents() {
        const kernelConnection = this.kernel.session?.kernel;
        if (!kernelConnection) {
            return;
        }
        kernelConnection.anyMessage.connect(this.onAnyMessage, this);
        this.disposables.push(new Disposable(() => kernelConnection.anyMessage.disconnect(this.onAnyMessage, this)));
    }
    @swallowExceptions()
    private onAnyMessage(_: IKernelConnection, msg: IAnyMessageArgs) {
        if (msg.direction === 'recv' && msg.msg.header.msg_type === 'comm_open') {
            const commOpen = msg.msg as unknown as ICommOpenMsg<'iopub'> | ICommOpenMsg<'shell'>;
            const data = commOpen.content.data as {
                state?: { _model_module?: string; _model_module_version?: string; _model_name?: string };
            };
            if (data.state?._model_module && data.state._model_name) {
                this.sendTelemetryForWidgetModule(
                    data.state?._model_module,
                    data.state?._model_module_version || '',
                    data.state?._model_name
                ).catch(noop);
            }
        }
    }
}
