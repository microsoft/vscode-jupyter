// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import type { KernelMessage } from '@jupyterlab/services';
import { Event, EventEmitter, NotebookDocument } from 'vscode';
import { IApplicationShell, ICommandManager } from '../../../../platform/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../../../platform/common/constants';
import { traceVerbose, traceError, traceInfo, traceInfoIfCI } from '../../../../platform/logging';
import {
    IDisposableRegistry,
    IOutputChannel,
    IConfigurationService,
    IHttpClient,
    IsWebExtension
} from '../../../../platform/common/types';
import { Common, DataScience } from '../../../../platform/common/utils/localize';
import { noop } from '../../../../platform/common/utils/misc';
import { stripAnsi } from '../../../../platform/common/utils/regexp';
import {
    ILoadIPyWidgetClassFailureAction,
    InteractiveWindowMessages,
    IPyWidgetMessages,
    LoadIPyWidgetClassLoadAction,
    NotifyIPyWidgetWidgetVersionNotSupportedAction
} from '../../../../messageTypes';
import { IServiceContainer } from '../../../../platform/ioc/types';
import { sendTelemetryEvent, Telemetry } from '../../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../../platform/telemetry/helpers';
import { Commands } from '../../../../platform/common/constants';
import { IKernelProvider } from '../../../../kernels/types';
import { IPyWidgetMessageDispatcherFactory } from './ipyWidgetMessageDispatcherFactory';
import { IPyWidgetScriptSource } from '../scriptSourceProvider/ipyWidgetScriptSource';
import { IIPyWidgetMessageDispatcher, IWidgetScriptSourceProviderFactory } from '../types';
import { ConsoleForegroundColors } from '../../../../platform/logging/types';
import { createDeferred } from '../../../../platform/common/utils/async';
import { IWebviewCommunication } from '../../../../platform/webviews/types';
import { swallowExceptions } from '../../../../platform/common/utils/decorators';

/**
 * This class wraps all of the ipywidgets communication with a backing notebook
 */
//
export class CommonMessageCoordinator {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private cachedMessages: any[] = [];
    /**
     * Whether we have any handlers listerning to this event.
     */
    private listeningToPostMessageEvent?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        this.listeningToPostMessageEvent = true;
        return this.postEmitter.event;
    }
    private ipyWidgetMessageDispatcher?: IIPyWidgetMessageDispatcher;
    private ipyWidgetScriptSource?: IPyWidgetScriptSource;
    private appShell: IApplicationShell;
    private commandManager: ICommandManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly postEmitter = new EventEmitter<{ message: string; payload: any }>();
    private disposables: IDisposableRegistry;
    private jupyterOutput: IOutputChannel;
    private readonly configService: IConfigurationService;
    private webview: IWebviewCommunication | undefined;
    private modulesForWhichWeHaveDisplayedWidgetErrorMessage = new Set<string>();

    public constructor(
        private readonly document: NotebookDocument,
        private readonly serviceContainer: IServiceContainer
    ) {
        this.disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        this.jupyterOutput = this.serviceContainer.get<IOutputChannel>(IOutputChannel, STANDARD_OUTPUT_CHANNEL);
        this.appShell = this.serviceContainer.get<IApplicationShell>(IApplicationShell, IApplicationShell);
        this.commandManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
        this.configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
    }

    public dispose() {
        this.cachedMessages = [];
        this.ipyWidgetMessageDispatcher?.dispose(); // NOSONAR
        this.ipyWidgetScriptSource?.dispose(); // NOSONAR
    }

    public async attach(webview: IWebviewCommunication) {
        if (this.webview !== webview) {
            // New webview, make sure to initialize.
            this.initialize();

            // Save the webview
            this.webview = webview;
            const promise = createDeferred<void>();

            // Attach message requests to this webview (should dupe to all of them)
            this.postMessage(
                (e) => {
                    traceInfoIfCI(`${ConsoleForegroundColors.Green}Widget Coordinator sent ${e.message}`);
                    // Special case for webview URI translation
                    if (e.message === InteractiveWindowMessages.ConvertUriForUseInWebViewRequest) {
                        this.onMessage(InteractiveWindowMessages.ConvertUriForUseInWebViewResponse, {
                            request: e.payload,
                            response: webview.asWebviewUri(e.payload)
                        });
                    } else {
                        webview.postMessage({ type: e.message, payload: e.payload }).then(noop, noop);
                    }
                },
                this,
                this.disposables
            );
            webview.onDidReceiveMessage(
                (m) => {
                    traceInfoIfCI(`${ConsoleForegroundColors.Green}Widget Coordinator received ${m.type}`);
                    this.onMessage(m.type, m.payload);

                    // Special case the WidgetManager loaded message. It means we're ready
                    // to use a kernel. (IPyWidget Dispatcher uses this too)
                    if (m.type === IPyWidgetMessages.IPyWidgets_Ready) {
                        promise.resolve();
                    }
                },
                this,
                this.disposables
            );
            // In case the webview loaded earlier and it already sent the IPyWidgetMessages.IPyWidgets_Ready message
            // This way we don't make assumptions, we just query widgets and ask its its ready (avoids timing issues etc).
            webview
                .postMessage({ type: IPyWidgetMessages.IPyWidgets_IsReadyRequest, payload: undefined })
                .then(noop, noop);

            // Wait for the widgets ready message
            await promise.promise;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public onMessage(message: string, payload?: any): void {
        if (message === InteractiveWindowMessages.IPyWidgetLoadSuccess) {
            this.sendLoadSucceededTelemetry(payload);
        } else if (message === InteractiveWindowMessages.IPyWidgetLoadFailure) {
            this.handleWidgetLoadFailure(payload);
        } else if (message === InteractiveWindowMessages.IPyWidgetWidgetVersionNotSupported) {
            this.sendUnsupportedWidgetVersionFailureTelemetry(payload);
        } else if (message === InteractiveWindowMessages.IPyWidgetRenderFailure) {
            this.sendRenderFailureTelemetry(payload);
        } else if (message === InteractiveWindowMessages.IPyWidgetUnhandledKernelMessage) {
            this.handleUnhandledMessage(payload);
        }

        // Pass onto our two objects that are listening to messages

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.getIPyWidgetMessageDispatcher().receiveMessage({ message: message as any, payload }); // NOSONAR
        this.getIPyWidgetScriptSource().onMessage(message, payload);
    }

    private initialize() {
        traceVerbose('initialize CommonMessageCoordinator');
        // First hook up the widget script source that will listen to messages even before we start sending messages.
        this.getIPyWidgetScriptSource().initialize();
        this.getIPyWidgetMessageDispatcher().initialize();
    }

    private sendLoadSucceededTelemetry(payload: LoadIPyWidgetClassLoadAction) {
        try {
            sendTelemetryEvent(Telemetry.IPyWidgetLoadSuccess, 0, {
                moduleHash: getTelemetrySafeHashedString(payload.moduleName),
                moduleVersion: payload.moduleVersion
            });
        } catch {
            // do nothing on failure
        }
    }

    private handleWidgetLoadFailure(payload: ILoadIPyWidgetClassFailureAction) {
        try {
            let errorMessage: string = payload.error.toString();
            const cdnsEnabled = this.configService.getSettings(undefined).widgetScriptSources.length > 0;
            const key = `${payload.moduleName}:${payload.moduleVersion}`;
            if (!payload.isOnline) {
                errorMessage = DataScience.loadClassFailedWithNoInternet().format(
                    payload.moduleName,
                    payload.moduleVersion
                );
                this.appShell.showErrorMessage(errorMessage).then(noop, noop);
            } else if (!cdnsEnabled && !this.modulesForWhichWeHaveDisplayedWidgetErrorMessage.has(key)) {
                this.modulesForWhichWeHaveDisplayedWidgetErrorMessage.add(key);
                const moreInfo = Common.moreInfo();
                const enableDownloads = DataScience.enableCDNForWidgetsButton();
                errorMessage = DataScience.enableCDNForWidgetsSetting().format(
                    payload.moduleName,
                    payload.moduleVersion
                );
                this.appShell
                    .showErrorMessage(errorMessage, { modal: true }, ...[enableDownloads, moreInfo])
                    .then((selection) => {
                        switch (selection) {
                            case moreInfo:
                                this.appShell.openUrl('https://aka.ms/PVSCIPyWidgets');
                                break;
                            case enableDownloads:
                                this.enableCDNForWidgets().ignoreErrors();
                                break;
                            default:
                                break;
                        }
                    }, noop);
            }
            traceError(`Widget load failure ${errorMessage}`, payload);

            sendTelemetryEvent(Telemetry.IPyWidgetLoadFailure, 0, {
                isOnline: payload.isOnline,
                moduleHash: getTelemetrySafeHashedString(payload.moduleName),
                moduleVersion: payload.moduleVersion,
                timedout: payload.timedout
            });
        } catch {
            // do nothing on failure
        }
    }
    @swallowExceptions()
    private async enableCDNForWidgets() {
        await this.commandManager.executeCommand(Commands.EnableLoadingWidgetsFrom3rdPartySource);
        if (this.webview) {
            await this.webview.postMessage({ type: IPyWidgetMessages.IPyWidgets_AttemptToDownloadFailedWidgetsAgain });
        }
    }
    private sendUnsupportedWidgetVersionFailureTelemetry(payload: NotifyIPyWidgetWidgetVersionNotSupportedAction) {
        try {
            sendTelemetryEvent(Telemetry.IPyWidgetWidgetVersionNotSupportedLoadFailure, 0, {
                moduleHash: getTelemetrySafeHashedString(payload.moduleName),
                moduleVersion: payload.moduleVersion
            });
        } catch {
            // do nothing on failure
        }
    }
    private sendRenderFailureTelemetry(payload: Error) {
        try {
            traceError('Error rendering a widget: ', payload);
            sendTelemetryEvent(Telemetry.IPyWidgetRenderFailure);
        } catch {
            // Do nothing on a failure
        }
    }

    private handleUnhandledMessage(msg: KernelMessage.IMessage) {
        // Skip status messages
        if (msg.header.msg_type !== 'status') {
            try {
                // Special case errors, strip ansi codes from tracebacks so they print better.
                if (msg.header.msg_type === 'error') {
                    const errorMsg = msg as KernelMessage.IErrorMsg;
                    errorMsg.content.traceback = errorMsg.content.traceback.map(stripAnsi);
                }
                traceInfo(`Unhandled widget kernel message: ${msg.header.msg_type} ${msg.content}`);
                this.jupyterOutput.appendLine(
                    DataScience.unhandledMessage().format(msg.header.msg_type, JSON.stringify(msg.content))
                );
                sendTelemetryEvent(Telemetry.IPyWidgetUnhandledMessage, undefined, { msg_type: msg.header.msg_type });
            } catch {
                // Don't care if this doesn't get logged
            }
        }
    }
    private getIPyWidgetMessageDispatcher() {
        if (!this.ipyWidgetMessageDispatcher) {
            this.ipyWidgetMessageDispatcher = this.serviceContainer
                .get<IPyWidgetMessageDispatcherFactory>(IPyWidgetMessageDispatcherFactory)
                .create(this.document);
            this.disposables.push(this.ipyWidgetMessageDispatcher.postMessage(this.cacheOrSend, this));
        }
        return this.ipyWidgetMessageDispatcher;
    }

    private getIPyWidgetScriptSource() {
        if (!this.ipyWidgetScriptSource) {
            this.ipyWidgetScriptSource = new IPyWidgetScriptSource(
                this.document,
                this.serviceContainer.get<IKernelProvider>(IKernelProvider),
                this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry),
                this.serviceContainer.get<IConfigurationService>(IConfigurationService),
                this.serviceContainer.get<IHttpClient>(IHttpClient),
                this.serviceContainer.get<IWidgetScriptSourceProviderFactory>(IWidgetScriptSourceProviderFactory),
                this.serviceContainer.get<boolean>(IsWebExtension)
            );
            this.disposables.push(this.ipyWidgetScriptSource.postMessage(this.cacheOrSend, this));
        }
        return this.ipyWidgetScriptSource;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private cacheOrSend(data: any) {
        // If no one is listening to the messages, then cache these.
        // It means its too early to dispatch the messages, we need to wait for the event handlers to get bound.
        if (!this.listeningToPostMessageEvent) {
            traceInfoIfCI(`${ConsoleForegroundColors.Green}Queuing messages (no listenerts)`);
            this.cachedMessages.push(data);
            return;
        }
        this.cachedMessages.forEach((item) => this.postEmitter.fire(item));
        this.cachedMessages = [];
        this.postEmitter.fire(data);
    }
}
