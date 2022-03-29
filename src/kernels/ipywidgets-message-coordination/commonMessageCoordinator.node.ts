// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { KernelMessage } from '@jupyterlab/services';
import { Event, EventEmitter, NotebookDocument } from 'vscode';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../platform/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../platform/common/constants.node';
import { traceVerbose, traceError, traceInfo, traceInfoIfCI } from '../../platform/common/logger.node';
import { IFileSystem } from '../../platform/common/platform/types';
import { IPythonExecutionFactory } from '../../platform/common/process/types';
import {
    IDisposableRegistry,
    IOutputChannel,
    IConfigurationService,
    IHttpClient,
    IPersistentStateFactory,
    IExtensionContext
} from '../../platform/common/types';
import { Common, DataScience } from '../../platform/common/utils/localize.node';
import { noop } from '../../platform/common/utils/misc.node';
import { stripAnsi } from '../../platform/common/utils/regexp.node';
import { InteractiveWindowMessages } from '../../platform/messageTypes';
import { IInterpreterService } from '../../platform/interpreter/contracts.node';
import { IServiceContainer } from '../../platform/ioc/types';
import { ConsoleForegroundColors } from '../../platform/logging/_global.node';
import { sendTelemetryEvent } from '../../telemetry/index.node';
import { getTelemetrySafeHashedString } from '../../telemetry/helpers.node';
import { Telemetry, Commands } from '../../webviews/webview-side/common/constants';
import {
    LoadIPyWidgetClassLoadAction,
    ILoadIPyWidgetClassFailureAction,
    NotifyIPyWidgeWidgetVersionNotSupportedAction
} from '../../webviews/webview-side/interactive-common/redux/reducers/types';
import { IKernelProvider } from '../types';
import { IPyWidgetMessageDispatcherFactory } from './ipyWidgetMessageDispatcherFactory.node';
import { IPyWidgetScriptSource } from './ipyWidgetScriptSource.node';
import { IIPyWidgetMessageDispatcher } from './types';

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

    private constructor(
        private readonly document: NotebookDocument,
        private readonly serviceContainer: IServiceContainer
    ) {
        this.disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        this.jupyterOutput = this.serviceContainer.get<IOutputChannel>(IOutputChannel, STANDARD_OUTPUT_CHANNEL);
        this.appShell = this.serviceContainer.get<IApplicationShell>(IApplicationShell, IApplicationShell);
        this.commandManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
        this.configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
    }

    public static async create(
        document: NotebookDocument,
        serviceContainer: IServiceContainer
    ): Promise<CommonMessageCoordinator> {
        const result = new CommonMessageCoordinator(document, serviceContainer);
        await result.initialize();
        traceVerbose('Created and initailized CommonMessageCoordinator');
        return result;
    }

    public dispose() {
        this.ipyWidgetMessageDispatcher?.dispose(); // NOSONAR
        this.ipyWidgetScriptSource?.dispose(); // NOSONAR
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

    private async initialize(): Promise<void> {
        traceVerbose('initialize CommonMessageCoordinator');
        // First hook up the widget script source that will listen to messages even before we start sending messages.
        const promise = this.getIPyWidgetScriptSource().initialize();
        await promise.then(() => this.getIPyWidgetMessageDispatcher().initialize());
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
            if (!payload.isOnline) {
                errorMessage = DataScience.loadClassFailedWithNoInternet().format(
                    payload.moduleName,
                    payload.moduleVersion
                );
                this.appShell.showErrorMessage(errorMessage).then(noop, noop);
            } else if (!cdnsEnabled) {
                const moreInfo = Common.moreInfo();
                const enableDownloads = DataScience.enableCDNForWidgetsButton();
                errorMessage = DataScience.enableCDNForWidgetsSetting().format(
                    payload.moduleName,
                    payload.moduleVersion
                );
                this.appShell.showErrorMessage(errorMessage, ...[enableDownloads, moreInfo]).then((selection) => {
                    switch (selection) {
                        case moreInfo:
                            this.appShell.openUrl('https://aka.ms/PVSCIPyWidgets');
                            break;
                        case enableDownloads:
                            void this.commandManager.executeCommand(Commands.EnableLoadingWidgetsFrom3rdPartySource);
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
    private sendUnsupportedWidgetVersionFailureTelemetry(payload: NotifyIPyWidgeWidgetVersionNotSupportedAction) {
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
                this.serviceContainer.get<IFileSystem>(IFileSystem),
                this.serviceContainer.get<IInterpreterService>(IInterpreterService),
                this.serviceContainer.get<IConfigurationService>(IConfigurationService),
                this.serviceContainer.get<IHttpClient>(IHttpClient),
                this.serviceContainer.get<IApplicationShell>(IApplicationShell),
                this.serviceContainer.get<IWorkspaceService>(IWorkspaceService),
                this.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory),
                this.serviceContainer.get<IExtensionContext>(IExtensionContext),
                this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory)
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
