// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named, optional } from 'inversify';
import { DebugConfiguration, Uri } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { convertDebugProtocolVariableToIJupyterVariable } from '../../../kernels/variables/helpers';
import { IJupyterVariables } from '../../../kernels/variables/types';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { ICommandNameArgumentTypeMapping } from '../../../commands';
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
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { traceError, traceInfo } from '../../../platform/logging';
import { IShowDataViewerFromVariablePanel } from '../../../messageTypes';
import { sendTelemetryEvent } from '../../../telemetry';
import { EventName } from '../../../platform/telemetry/constants';
import { PythonEnvironment } from '../../../standalone/api/extension';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';
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
                    this.debugService.activeDebugSession.configuration &&
                    this.dataViewerDependencyService &&
                    this.interpreterService
                ) {
                    // Check the debug adapter session to get the python env that launched it
                    const pythonEnv = await this.getDebugAdapterPython(
                        this.debugService.activeDebugSession.configuration
                    );

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

    // For the given debug adapter, return the PythonEnvironment used to launch it
    // Mirrors the logic from Python extension here:
    // https://github.com/microsoft/vscode-python/blob/35b813f37d1ceec547277180e3aa07bd24d86f89/src/client/debugger/extension/adapter/factory.ts#L116
    private async getDebugAdapterPython(
        debugConfiguration: DebugConfiguration
    ): Promise<PythonEnvironment | undefined> {
        if (!this.interpreterService) {
            // Interpreter service is optional
            traceInfo('Interpreter Service missing when trying getDebugAdapterPython');
            return;
        }

        // Check debugAdapterPython and pythonPath
        let pythonPath: string = '';
        if (debugConfiguration.debugAdapterPython !== undefined) {
            traceInfo('Found debugAdapterPython on Debug Configuration to use');
            pythonPath = debugConfiguration.debugAdapterPython;
        } else if (debugConfiguration.pythonPath) {
            traceInfo('Found pythonPath on Debug Configuration to use');
            pythonPath = debugConfiguration.pythonPath;
        }

        if (pythonPath) {
            let untildePath = pythonPath;
            if (untildePath.startsWith('~') && this.platformService.homeDir) {
                untildePath = untildify(untildePath, this.platformService.homeDir.path);
            }

            return this.interpreterService.getInterpreterDetails(Uri.file(untildePath));
        } else {
            // Failed to find the expected configuration items, use active interpreter (might be attach scenario)
            return this.interpreterService.getActiveInterpreter();
        }
    }
}
