// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import type * as jupyterlabService from '@jupyterlab/services';
import { Event, EventEmitter, NotebookDocument, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { traceError, traceInfo, traceVerbose } from '../../platform/logging';
import {
    IDisposableRegistry,
    IConfigurationService,
    IHttpClient,
    IPersistentStateFactory,
    IDisposable
} from '../../platform/common/types';
import { InteractiveWindowMessages, IPyWidgetMessages } from '../../platform/messageTypes';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../../webviews/webview-side/common/constants';
import { IKernel, IKernelProvider } from '../types';
import { IPyWidgetScriptSourceProvider } from './ipyWidgetScriptSourceProvider';
import { ILocalResourceUriConverter, IWidgetScriptSourceProviderFactory, WidgetScriptSource } from './types';
import { ConsoleForegroundColors } from '../../platform/logging/types';
import { getAssociatedNotebookDocument } from '../helpers';

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
    private jupyterLab?: typeof jupyterlabService;
    private scriptProvider?: IPyWidgetScriptSourceProvider;
    private allWidgetScriptsSent?: boolean;
    private disposables: IDisposable[] = [];
    /**
     * Key value pair of widget modules along with the version that needs to be loaded.
     */
    private pendingModuleRequests = new Map<string, string | undefined>();
    constructor(
        private readonly document: NotebookDocument,
        private readonly kernelProvider: IKernelProvider,
        disposables: IDisposableRegistry,
        private readonly configurationSettings: IConfigurationService,
        private readonly httpClient: IHttpClient,
        private readonly appShell: IApplicationShell,
        private readonly workspaceService: IWorkspaceService,
        private readonly stateFactory: IPersistentStateFactory,
        private readonly sourceProviderFactory: IWidgetScriptSourceProviderFactory,
        private readonly uriConverter: ILocalResourceUriConverter
    ) {
        uriConverter.requestUri(
            (e) =>
                this.postEmitter.fire({
                    message: InteractiveWindowMessages.ConvertUriForUseInWebViewRequest,
                    payload: e
                }),
            undefined,
            disposables
        );
        disposables.push(this);
        this.kernelProvider.onDidStartKernel(
            (e) => {
                if (getAssociatedNotebookDocument(e) === this.document) {
                    this.initialize().catch(traceError.bind('Failed to initialize'));
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
            if (response) {
                this.uriConverter.resolveUri(response.request, response.response);
            }
        } else if (message === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest) {
            if (payload) {
                const { moduleName, moduleVersion } = payload as { moduleName: string; moduleVersion: string };
                if (this.scriptProvider && !this.allWidgetScriptsSent) {
                    this.scriptProvider
                        .getWidgetScriptSources()
                        .then((sources) => {
                            sources.forEach((widgetSource) => {
                                // Send to UI (even if there's an error) instead of hanging while waiting for a response.
                                this.postEmitter.fire({
                                    message: IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse,
                                    payload: widgetSource
                                });
                            });
                        })
                        .finally(() => {
                            this.allWidgetScriptsSent = true;
                            traceInfo(`${ConsoleForegroundColors.Green}Fetch Script for ${JSON.stringify(payload)}`);
                            this.sendWidgetSource(moduleName, moduleVersion).catch(
                                traceError.bind(undefined, 'Failed to send widget sources upon ready')
                            );
                        });
                } else {
                    traceInfo(`${ConsoleForegroundColors.Green}Fetch Script for ${JSON.stringify(payload)}`);
                    this.sendWidgetSource(moduleName, moduleVersion).catch(
                        traceError.bind(undefined, 'Failed to send widget sources upon ready')
                    );
                }
            }
        }
    }
    public async initialize() {
        if (!this.jupyterLab) {
            // Lazy load jupyter lab for faster extension loading.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this.jupyterLab = require('@jupyterlab/services') as typeof jupyterlabService; // NOSONAR
        }

        if (!this.kernel) {
            this.kernel = await this.kernelProvider.get(this.document.uri);
        }
        if (!this.kernel) {
            return;
        }
        if (this.scriptProvider) {
            return;
        }
        this.scriptProvider = new IPyWidgetScriptSourceProvider(
            this.kernel,
            this.uriConverter,
            this.appShell,
            this.configurationSettings,
            this.workspaceService,
            this.stateFactory,
            this.httpClient,
            this.sourceProviderFactory
        );
        this.initializeNotebook();
        traceVerbose('IPyWidgetScriptSource.initialize');
    }

    /**
     * Send the widget script source for a specific widget module & version.
     * This is a request made when a widget is certainly used in a notebook.
     */
    private async sendWidgetSource(moduleName?: string, moduleVersion: string = '*') {
        // Standard widgets area already available, hence no need to look for them.
        if (!moduleName || moduleName.startsWith('@jupyter')) {
            return;
        }
        if (!this.kernel || !this.scriptProvider) {
            this.pendingModuleRequests.set(moduleName, moduleVersion);
            return;
        }

        let widgetSource: WidgetScriptSource = { moduleName };
        try {
            traceInfo(`${ConsoleForegroundColors.Green}Fetch Script for ${moduleName}`);
            widgetSource = await this.scriptProvider.getWidgetScriptSource(moduleName, moduleVersion);
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
    private initializeNotebook() {
        if (!this.kernel) {
            return;
        }
        this.kernel.onDisposed(() => this.dispose());
        this.handlePendingRequests();
    }
    private handlePendingRequests() {
        const pendingModuleNames = Array.from(this.pendingModuleRequests.keys());
        while (pendingModuleNames.length) {
            const moduleName = pendingModuleNames.shift();
            if (moduleName) {
                const moduleVersion = this.pendingModuleRequests.get(moduleName)!;
                this.pendingModuleRequests.delete(moduleName);
                this.sendWidgetSource(moduleName, moduleVersion).catch(
                    traceError.bind(`Failed to send WidgetScript for ${moduleName}`)
                );
            }
        }
    }
}
