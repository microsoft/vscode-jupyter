// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named, optional } from 'inversify';
import { Uri } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { convertDebugProtocolVariableToIJupyterVariable } from '../../../kernels/variables/helpers';
import { IJupyterVariables } from '../../../kernels/variables/types';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { ICommandNameArgumentTypeMapping } from '../../../platform/common/application/commands';
import {
    IApplicationShell,
    ICommandManager,
    IDebugService,
    IWorkspaceService
} from '../../../platform/common/application/types';
import { Commands, Identifiers } from '../../../platform/common/constants';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IConfigurationService, IDisposableRegistry } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { untildify } from '../../../platform/common/utils/platform';
import { IDataScienceErrorHandler } from '../../../platform/errors/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { traceError } from '../../../platform/logging';
import { IShowDataViewerFromVariablePanel } from '../../../platform/messageTypes';
import { sendTelemetryEvent } from '../../../telemetry';
import { EventName } from '../../../telemetry/constants';
import { DataViewerChecker } from './dataViewerChecker';
import { IDataViewerDependencyService, IDataViewerFactory, IJupyterVariableDataProviderFactory } from './types';

@injectable()
export class DataViewerCommandRegistry implements IExtensionSingleActivationService {
    private dataViewerChecker: DataViewerChecker;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDebugService) @optional() private debugService: IDebugService | undefined,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IJupyterVariableDataProviderFactory)
        @optional()
        private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory | undefined,
        @inject(IDataViewerFactory) @optional() private readonly dataViewerFactory: IDataViewerFactory | undefined,
        @inject(IJupyterVariables)
        @optional()
        @named(Identifiers.DEBUGGER_VARIABLES)
        private variableProvider: IJupyterVariables | undefined,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IDataViewerDependencyService)
        @optional()
        private readonly dataViewerDependencyService: IDataViewerDependencyService | undefined,
        @inject(IInterpreterService) @optional() private readonly interpreterService: IInterpreterService | undefined,
        @inject(IPlatformService) private readonly platformService: IPlatformService
    ) {
        this.dataViewerChecker = new DataViewerChecker(configService, appShell);
        if (!this.workspace.isTrusted) {
            this.workspace.onDidGrantWorkspaceTrust(this.registerCommandsIfTrusted, this, this.disposables);
        }
    }
    async activate(): Promise<void> {
        this.registerCommandsIfTrusted();
    }
    private registerCommandsIfTrusted() {
        if (!this.workspace.isTrusted) {
            return;
        }
        this.registerCommand(Commands.ShowDataViewer, this.onVariablePanelShowDataViewerRequest);
    }
    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = this.commandManager.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }
    private async onVariablePanelShowDataViewerRequest(request: IShowDataViewerFromVariablePanel) {
        sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST);
        if (
            this.debugService?.activeDebugSession &&
            this.variableProvider &&
            this.jupyterVariableDataProviderFactory &&
            this.dataViewerFactory
        ) {
            try {
                // First find out the current python environment that we are working with
                if (
                    this.debugService.activeDebugSession.configuration.python &&
                    this.dataViewerDependencyService &&
                    this.interpreterService
                ) {
                    // Check to see that we are actually getting a string here as it looks like one customer was not
                    if (typeof this.debugService.activeDebugSession.configuration.python !== 'string') {
                        // https://github.com/microsoft/vscode-jupyter/issues/10007
                        // Error thrown here will be caught and logged by the catch below to send
                        throw new Error(
                            `active.DebugSession.configuration.python is not a string: ${JSON.stringify(
                                this.debugService.activeDebugSession.configuration.python
                            )}`
                        );
                    }

                    // Uri won't work with ~ so untildify first
                    let untildePath = this.debugService.activeDebugSession.configuration.python;
                    if (untildePath.startsWith('~') && this.platformService.homeDir) {
                        untildePath = untildify(untildePath, this.platformService.homeDir.path);
                    }

                    const pythonEnv = await this.interpreterService.getInterpreterDetails(Uri.file(untildePath));
                    // Check that we have dependencies installed for data viewer
                    pythonEnv && (await this.dataViewerDependencyService.checkAndInstallMissingDependencies(pythonEnv));
                }

                const variable = convertDebugProtocolVariableToIJupyterVariable(
                    request.variable as DebugProtocol.Variable
                );
                const jupyterVariable = await this.variableProvider.getFullVariable(variable);
                const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                    jupyterVariable
                );
                const dataFrameInfo = await jupyterVariableDataProvider.getDataFrameInfo();
                const columnSize = dataFrameInfo?.columns?.length;
                if (columnSize && (await this.dataViewerChecker.isRequestedColumnSizeAllowed(columnSize))) {
                    const title: string = `${DataScience.dataExplorerTitle()} - ${jupyterVariable.name}`;
                    await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
                    sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS);
                }
            } catch (e) {
                sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR, undefined, undefined, e);
                traceError(e);
                this.errorHandler.handleError(e).then(noop, noop);
            }
        }
    }
}
