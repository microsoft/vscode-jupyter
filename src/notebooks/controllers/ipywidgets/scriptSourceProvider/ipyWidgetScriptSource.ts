// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, EventEmitter, NotebookDocument, Uri } from 'vscode';
import { traceError, traceInfo, traceVerbose, traceWarning } from '../../../../platform/logging';
import {
    IDisposableRegistry,
    IConfigurationService,
    IHttpClient,
    IDisposable
} from '../../../../platform/common/types';
import { InteractiveWindowMessages, IPyWidgetMessages } from '../../../../messageTypes';
import { sendTelemetryEvent, Telemetry } from '../../../../telemetry';
import { IKernel, IKernelProvider } from '../../../../kernels/types';
import { IPyWidgetScriptSourceProvider } from './ipyWidgetScriptSourceProvider';
import { ILocalResourceUriConverter, IWidgetScriptSourceProviderFactory, WidgetScriptSource } from '../types';
import { ConsoleForegroundColors } from '../../../../platform/logging/types';
import { noop } from '../../../../platform/common/utils/misc';
import { createDeferred, Deferred } from '../../../../platform/common/utils/async';
import { ScriptUriConverter } from './scriptUriConverter';
import { ResourceMap } from '../../../../platform/vscode-path/map';
import { CDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider';

/**
 * Handles messages from the kernel related to setting up widgets.
 */
export class IPyWidgetScriptSource {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }
    private postEmitter = new EventEmitter<{
        message: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any;
    }>();
    private kernel?: IKernel;
    private scriptProvider?: IPyWidgetScriptSourceProvider;
    private allWidgetScriptsSent?: boolean;
    private disposables: IDisposable[] = [];
    /**
     * Whether the webview has access to the internet to download widget JS files from the CDN.
     */
    private readonly isWebViewOnline = createDeferred<boolean>();
    private readonly widgetSources = new Map<string, WidgetScriptSource>();
    /**
     * Key value pair of widget modules along with the version that needs to be loaded.
     */
    private pendingModuleRequests = new Map<string, { moduleVersion?: string; requestId?: string }>();
    private readonly uriConverter: ILocalResourceUriConverter;
    private readonly uriTranslationRequests = new ResourceMap<Deferred<Uri>>();
    constructor(
        private readonly document: NotebookDocument,
        private readonly kernelProvider: IKernelProvider,
        disposables: IDisposableRegistry,
        private readonly configurationSettings: IConfigurationService,
        private readonly httpClient: IHttpClient,
        private readonly sourceProviderFactory: IWidgetScriptSourceProviderFactory,
        isWebExtension: boolean,
        private readonly cdnScriptProvider: CDNWidgetScriptSourceProvider
    ) {
        this.uriConverter = new ScriptUriConverter(isWebExtension, (resource) => {
            if (!this.uriTranslationRequests.has(resource))
                this.uriTranslationRequests.set(resource, createDeferred<Uri>());
            this.postEmitter.fire({
                message: InteractiveWindowMessages.ConvertUriForUseInWebViewRequest,
                payload: resource
            });
            return this.uriTranslationRequests.get(resource)!.promise;
        });
        // Don't leave dangling promises.
        this.isWebViewOnline.promise.catch(noop);
        disposables.push(this);
        this.kernelProvider.onDidStartKernel(
            (e) => {
                if (e.notebook === this.document) {
                    this.initialize();
                }
            },
            this,
            this.disposables
        );
    }

    public dispose() {
        while (this.disposables.length) {
            this.disposables.shift()?.dispose(); // NOSONAR
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public onMessage(message: string, payload?: any): void {
        if (message === InteractiveWindowMessages.ConvertUriForUseInWebViewResponse) {
            const response: undefined | { request: Uri; response: Uri } = payload;
            if (response && this.uriTranslationRequests.has(response.request)) {
                this.uriTranslationRequests.get(response.request)!.resolve(response.response);
            }
        } else if (message === IPyWidgetMessages.IPyWidgets_Ready) {
            this.sendBaseUrl();
            this.sendWidgetScriptSources().catch(noop);
        } else if (message === IPyWidgetMessages.IPyWidgets_IsOnline) {
            const isOnline = (payload as { isOnline: boolean }).isOnline;
            this.isWebViewOnline.resolve(isOnline);
        } else if (message === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest) {
            if (payload) {
                this.onRequestWidgetScript(
                    payload as { moduleName: string; moduleVersion: string; requestId: string }
                ).catch(noop);
            }
        }
    }
    public initialize() {
        if (!this.kernel) {
            this.kernel = this.kernelProvider.get(this.document);
        }
        if (!this.kernel?.session) {
            return;
        }
        if (this.scriptProvider) {
            return;
        }
        this.scriptProvider = new IPyWidgetScriptSourceProvider(
            this.kernel,
            this.uriConverter,
            this.configurationSettings,
            this.httpClient,
            this.sourceProviderFactory,
            this.isWebViewOnline.promise,
            this.cdnScriptProvider
        );
        this.kernel.onDisposed(() => this.dispose());
        this.handlePendingRequests();
        this.sendBaseUrl();
        traceVerbose('IPyWidgetScriptSource.initialize');
    }
    /**
     * Sends the base url of the remote Jupyter server to the webview.
     * Jupyter Widgets needs this to load scripts from the remote jupyter server.
     */
    private sendBaseUrl() {
        if (!this.scriptProvider) {
            return;
        }
        // Send to UI (even if there's an error) instead of hanging while waiting for a response.
        this.scriptProvider
            .getBaseUrl()
            .then((baseUrl) => {
                if (baseUrl) {
                    this.postEmitter.fire({
                        message: IPyWidgetMessages.IPyWidgets_BaseUrlResponse,
                        payload: baseUrl.toString()
                    });
                }
            })
            .catch((ex) => traceError(`Failed to get baseUrl`, ex));
    }
    /**
     * Outputs like HTML and JavaScript can have references to widget scripts as well,
     * hence we need to eagerly load these scripts.
     */
    private async sendWidgetScriptSources() {
        if (!this.scriptProvider) {
            return;
        }
        if (this.allWidgetScriptsSent) {
            return;
        }
        // Ensure we send all of the widget script sources found in the `<python env>/share/jupyter/nbextensions` folder.
        try {
            const sources = await this.scriptProvider.getWidgetScriptSources();
            sources.forEach((widgetSource) => {
                // If we have a widget source from CDN, never overwrite that.
                if (this.widgetSources.get(widgetSource.moduleName)?.source !== 'cdn') {
                    this.widgetSources.set(widgetSource.moduleName, widgetSource);
                }
                // Send to UI (even if there's an error) instead of hanging while waiting for a response.
                this.postEmitter.fire({
                    message: IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse,
                    payload: widgetSource
                });
            });
        } catch (ex) {
            traceWarning(`Failed to fetch script sources`, ex);
        } finally {
            this.allWidgetScriptsSent = true;
        }
    }
    private async onRequestWidgetScript(payload: { moduleName: string; moduleVersion: string; requestId: string }) {
        const { moduleName, moduleVersion, requestId } = payload;

        traceInfo(`${ConsoleForegroundColors.Green}Fetch Script for ${JSON.stringify(payload)}`);
        await this.sendWidgetSource(moduleName, moduleVersion, requestId).catch((ex) =>
            traceError('Failed to send widget sources upon ready', ex)
        );

        // Ensure we send all of the widget script sources found in the `<python env>/share/jupyter/nbextensions` folder.
        if (this.scriptProvider && !this.allWidgetScriptsSent) {
            try {
                await this.sendWidgetScriptSources();
            } finally {
                this.sendWidgetSource(moduleName, moduleVersion, requestId).catch(
                    traceError.bind(undefined, 'Failed to send widget sources upon ready')
                );
            }
        }
    }
    /**
     * Send the widget script source for a specific widget module & version.
     * This is a request made when a widget is certainly used in a notebook.
     */
    private async sendWidgetSource(moduleName?: string, moduleVersion: string = '*', requestId?: string) {
        // Standard widgets area already available, hence no need to look for them.
        if (!moduleName || moduleName.startsWith('@jupyter')) {
            return;
        }
        if (!this.kernel || !this.scriptProvider) {
            this.pendingModuleRequests.set(moduleName, { moduleVersion, requestId });
            return;
        }

        let widgetSource: WidgetScriptSource = { moduleName, requestId };
        try {
            traceInfo(`${ConsoleForegroundColors.Green}Fetch Script for ${moduleName}`);
            widgetSource = await this.scriptProvider.getWidgetScriptSource(moduleName, moduleVersion);
            // If we have a widget source from CDN, never overwrite that.
            if (this.widgetSources.get(widgetSource.moduleName)?.source !== 'cdn') {
                this.widgetSources.set(widgetSource.moduleName, widgetSource);
            }
        } catch (ex) {
            traceError('Failed to get widget source due to an error', ex);
            sendTelemetryEvent(Telemetry.HashedIPyWidgetScriptDiscoveryError);
        } finally {
            traceInfo(
                `${ConsoleForegroundColors.Green}Script for ${moduleName}, is ${widgetSource.scriptUri} from ${widgetSource.source}`
            );
            // Send to UI (even if there's an error) continues instead of hanging while waiting for a response.
            this.postEmitter.fire({
                message: IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse,
                payload: widgetSource
            });
        }
    }
    private handlePendingRequests() {
        const pendingModuleNames = Array.from(this.pendingModuleRequests.keys());
        while (pendingModuleNames.length) {
            const moduleName = pendingModuleNames.shift();
            if (moduleName) {
                const { moduleVersion, requestId } = this.pendingModuleRequests.get(moduleName)!;
                this.pendingModuleRequests.delete(moduleName);
                this.sendWidgetSource(moduleName, moduleVersion, requestId).catch(
                    traceError.bind(`Failed to send WidgetScript for ${moduleName}`)
                );
            }
        }
    }
}
