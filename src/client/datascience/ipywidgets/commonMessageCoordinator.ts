// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { KernelMessage } from '@jupyterlab/services';
import { injectable } from 'inversify';
import stripAnsi from 'strip-ansi';
import { Event, EventEmitter, Uri } from 'vscode';
import {
    ILoadIPyWidgetClassFailureAction,
    LoadIPyWidgetClassLoadAction,
    NotifyIPyWidgeWidgetVersionNotSupportedAction
} from '../../../datascience-ui/interactive-common/redux/reducers/types';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../common/constants';
import { traceError, traceInfo } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import {
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext,
    IHttpClient,
    IOutputChannel,
    IPersistentStateFactory
} from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../telemetry/helpers';
import { Commands, Telemetry } from '../constants';
import { InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { INotebookProvider } from '../types';
import { IPyWidgetMessageDispatcherFactory } from './ipyWidgetMessageDispatcherFactory';
import { IPyWidgetScriptSource } from './ipyWidgetScriptSource';
import { IIPyWidgetMessageDispatcher } from './types';

/**
 * This class wraps all of the ipywidgets communication with a backing notebook
 */
@injectable()
//
export class CommonMessageCoordinator {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }
    private ipyWidgetMessageDispatcher?: IIPyWidgetMessageDispatcher;
    private ipyWidgetScriptSource?: IPyWidgetScriptSource;
    private appShell: IApplicationShell;
    private commandManager: ICommandManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private postEmitter: EventEmitter<{ message: string; payload: any }>;
    private disposables: IDisposableRegistry;
    private jupyterOutput: IOutputChannel;

    private constructor(
        private readonly identity: Uri,
        private readonly serviceContainer: IServiceContainer,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        postEmitter?: EventEmitter<{ message: string; payload: any }>
    ) {
        this.postEmitter =
            postEmitter ??
            new EventEmitter<{
                message: string;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                payload: any;
            }>();
        this.disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        this.jupyterOutput = this.serviceContainer.get<IOutputChannel>(IOutputChannel, STANDARD_OUTPUT_CHANNEL);
        this.appShell = this.serviceContainer.get<IApplicationShell>(IApplicationShell, IApplicationShell);
        this.commandManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
    }

    public static async create(
        identity: Uri,
        serviceContainer: IServiceContainer,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        postEmitter?: EventEmitter<{ message: string; payload: any }>
    ): Promise<CommonMessageCoordinator> {
        const result = new CommonMessageCoordinator(identity, serviceContainer, postEmitter);
        await result.initialize();
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
        this.getIPyWidgetMessageDispatcher()?.receiveMessage({ message: message as any, payload }); // NOSONAR
        this.getIPyWidgetScriptSource()?.onMessage(message, payload);
    }

    private initialize(): Promise<[void, void]> {
        return Promise.all([
            this.getIPyWidgetMessageDispatcher()?.initialize(),
            this.getIPyWidgetScriptSource()?.initialize()
        ]);
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
            if (!payload.isOnline) {
                errorMessage = localize.DataScience.loadClassFailedWithNoInternet().format(
                    payload.moduleName,
                    payload.moduleVersion
                );
                this.appShell.showErrorMessage(errorMessage).then(noop, noop);
            } else if (!payload.cdnsUsed) {
                const moreInfo = localize.Common.moreInfo();
                const enableDownloads = localize.DataScience.enableCDNForWidgetsButton();
                errorMessage = localize.DataScience.enableCDNForWidgetsSetting().format(
                    payload.moduleName,
                    payload.moduleVersion
                );
                this.appShell.showErrorMessage(errorMessage, ...[moreInfo, enableDownloads]).then((selection) => {
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
                })
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
                    localize.DataScience.unhandledMessage().format(msg.header.msg_type, JSON.stringify(msg.content))
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
                .create(this.identity);
            this.disposables.push(
                this.ipyWidgetMessageDispatcher.postMessage(this.postEmitter.fire.bind(this.postEmitter))
            );
        }
        return this.ipyWidgetMessageDispatcher;
    }

    private getIPyWidgetScriptSource() {
        if (!this.ipyWidgetScriptSource) {
            this.ipyWidgetScriptSource = new IPyWidgetScriptSource(
                this.identity,
                this.serviceContainer.get<INotebookProvider>(INotebookProvider),
                this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry),
                this.serviceContainer.get<IFileSystem>(IFileSystem),
                this.serviceContainer.get<IInterpreterService>(IInterpreterService),
                this.serviceContainer.get<IConfigurationService>(IConfigurationService),
                this.serviceContainer.get<IHttpClient>(IHttpClient),
                this.serviceContainer.get<IApplicationShell>(IApplicationShell),
                this.serviceContainer.get<IWorkspaceService>(IWorkspaceService),
                this.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory),
                this.serviceContainer.get<IExtensionContext>(IExtensionContext)
            );
            this.disposables.push(this.ipyWidgetScriptSource.postMessage(this.postEmitter.fire.bind(this.postEmitter)));
            this.disposables.push(
                this.ipyWidgetScriptSource.postInternalMessage(this.postEmitter.fire.bind(this.postEmitter))
            );
        }
        return this.ipyWidgetScriptSource;
    }
}
