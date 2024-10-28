// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named, optional } from 'inversify';
import { DebugConfiguration, Memento, Uri, commands, window, workspace } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { convertDebugProtocolVariableToIJupyterVariable } from '../../../kernels/variables/helpers';
import { IJupyterVariable, IJupyterVariables } from '../../../kernels/variables/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { ICommandNameArgumentTypeMapping } from '../../../commands';
import { IDebugService } from '../../../platform/common/application/types';
import { Commands, Identifiers, JupyterNotebookView, Telemetry } from '../../../platform/common/constants';
import { IPlatformService } from '../../../platform/common/platform/types';
import {
    Experiments,
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposableRegistry,
    IExperimentService,
    IMemento
} from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { untildify } from '../../../platform/common/utils/platform';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { logger } from '../../../platform/logging';
import { sendTelemetryEvent } from '../../../telemetry';
import { EventName } from '../../../platform/telemetry/constants';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';
import { DataViewerChecker } from './dataViewerChecker';
import { IDataViewerDependencyService, IDataViewerFactory, IJupyterVariableDataProviderFactory } from './types';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IKernelProvider } from '../../../kernels/types';
import { IInteractiveWindowProvider } from '../../../interactive-window/types';
import { IShowDataViewerFromVariablePanel } from '../../../messageTypes';
import { DataViewerDelegator } from './dataViewerDelegator';

export const PromptAboutDeprecation = 'ds_prompt_about_deprecation';

@injectable()
export class DataViewerCommandRegistry implements IExtensionSyncActivationService {
    private dataViewerChecker: DataViewerChecker;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IDebugService) @optional() private debugService: IDebugService | undefined,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IJupyterVariableDataProviderFactory)
        @optional()
        private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory | undefined,
        @inject(IDataViewerFactory) @optional() private readonly dataViewerFactory: IDataViewerFactory | undefined,
        @inject(IJupyterVariables)
        @named(Identifiers.DEBUGGER_VARIABLES)
        private variableProvider: IJupyterVariables,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IDataViewerDependencyService)
        @optional()
        private readonly dataViewerDependencyService: IDataViewerDependencyService | undefined,
        @inject(IInterpreterService) @optional() private readonly interpreterService: IInterpreterService | undefined,
        @inject(IPlatformService) private readonly platformService: IPlatformService,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IExperimentService) private readonly experimentService: IExperimentService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(DataViewerDelegator) private readonly dataViewerDelegator: DataViewerDelegator
    ) {
        this.dataViewerChecker = new DataViewerChecker(configService);
        if (!workspace.isTrusted) {
            workspace.onDidGrantWorkspaceTrust(this.registerCommandsIfTrusted, this, this.disposables);
        }
    }
    activate() {
        this.registerCommandsIfTrusted();
    }
    private registerCommandsIfTrusted() {
        if (!workspace.isTrusted) {
            return;
        }
        this.registerCommand(Commands.ShowDataViewer, this.delegateDataViewer);
        this.registerCommand(Commands.ShowJupyterDataViewer, this.delegateDataViewer);
    }
    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = commands.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }

    private async delegateDataViewer(request: IJupyterVariable | IShowDataViewerFromVariablePanel) {
        const variable = 'variable' in request ? await this.getVariableFromRequest(request) : request;
        if (!variable) {
            logger.error('Variable info could not be retreived');
            sendTelemetryEvent(Telemetry.FailedShowDataViewer, undefined, {
                reason: 'no variable info',
                fromVariableView: false
            });
            return;
        }
        return this.dataViewerDelegator.showContributedDataViewer(variable, false);
    }

    // get the information needed about the request from the debug variable view
    private async getVariableFromRequest(request: IShowDataViewerFromVariablePanel) {
        if (this.variableProvider) {
            const variable = convertDebugProtocolVariableToIJupyterVariable(
                request.variable as unknown as DebugProtocol.Variable
            );
            try {
                const result = await this.variableProvider.getFullVariable(variable);
                return result;
            } catch (e) {
                logger.warn('Full variable info could not be retreived, will attempt with partial info.', e);
                return variable;
            }
        }
    }

    // @ts-ignore: temporarily disable the warning and keep the code. Will be removed later.
    private async showJupyterVariableView(requestVariable: IJupyterVariable) {
        sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST);

        // DataViewerDeprecation
        const deprecateDataViewer = this.experimentService.inExperiment(Experiments.DataViewerDeprecation);
        if (!this.globalMemento.get(PromptAboutDeprecation) && deprecateDataViewer) {
            this.globalMemento.update(PromptAboutDeprecation, true).then(noop, noop);

            window
                .showInformationMessage(
                    DataScience.dataViewerDeprecationMessage,
                    DataScience.dataViewerDeprecationRecommendationActionMessage
                )
                .then((action) => {
                    if (action === DataScience.dataViewerDeprecationRecommendationActionMessage) {
                        commands
                            .executeCommand('workbench.extensions.search', '@tag:jupyterVariableViewers')
                            .then(noop, noop);
                    }
                }, noop);
        }

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

                const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                    requestVariable
                );
                const dataFrameInfo = await jupyterVariableDataProvider.getDataFrameInfo();
                const columnSize = dataFrameInfo?.columns?.length;
                if (columnSize && (await this.dataViewerChecker.isRequestedColumnSizeAllowed(columnSize))) {
                    const title: string = `${DataScience.dataExplorerTitle} - ${requestVariable.name}`;
                    const dv = await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
                    sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS);
                    return dv;
                }
            } catch (e) {
                sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR, undefined, undefined, e);
                logger.error(e);
                this.errorHandler.handleError(e).then(noop, noop);
            }
        } else {
            try {
                const activeKernel = this.getActiveKernel();

                if (activeKernel && this.jupyterVariableDataProviderFactory && this.dataViewerFactory) {
                    // Create a variable data provider and pass it to the data viewer factory to create the data viewer
                    const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                        requestVariable,
                        activeKernel
                    );

                    const title: string = `${DataScience.dataExplorerTitle} - ${requestVariable.name}`;
                    return await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
                }
            } catch (e) {
                logger.error(e);
                sendTelemetryEvent(Telemetry.FailedShowDataViewer);
                window.showErrorMessage(DataScience.showDataViewerFail).then(noop, noop);
            }
        }
    }

    private getActiveKernel() {
        const activeNotebook = window.activeNotebookEditor?.notebook;
        const activeJupyterNotebookKernel =
            activeNotebook?.notebookType == JupyterNotebookView ? this.kernelProvider.get(activeNotebook) : undefined;

        if (activeJupyterNotebookKernel) {
            return activeJupyterNotebookKernel;
        }
        const interactiveWindowDoc = this.getActiveInteractiveWindowDocument();
        const activeInteractiveWindowKernel = interactiveWindowDoc
            ? this.kernelProvider.get(interactiveWindowDoc)
            : undefined;

        if (activeInteractiveWindowKernel) {
            return activeInteractiveWindowKernel;
        }
        const activeDataViewer = this.dataViewerFactory?.activeViewer;
        return activeDataViewer
            ? this.kernelProvider.kernels.find((item) => item === activeDataViewer.kernel)
            : undefined;
    }

    private getActiveInteractiveWindowDocument() {
        const interactiveWindow = this.interactiveWindowProvider.getActiveOrAssociatedInteractiveWindow();
        if (!interactiveWindow) {
            return;
        }
        return workspace.notebookDocuments.find(
            (notebookDocument) => notebookDocument === interactiveWindow?.notebookDocument
        );
    }

    // For the given debug adapter, return the PythonEnvironment used to launch it
    // Mirrors the logic from Python extension here:
    // https://github.com/microsoft/vscode-python/blob/35b813f37d1ceec547277180e3aa07bd24d86f89/src/client/debugger/extension/adapter/factory.ts#L116
    private async getDebugAdapterPython(
        debugConfiguration: DebugConfiguration
    ): Promise<PythonEnvironment | undefined> {
        if (!this.interpreterService) {
            // Interpreter service is optional
            logger.info('Interpreter Service missing when trying getDebugAdapterPython');
            return;
        }

        // Check debugAdapterPython and pythonPath
        let pythonPath: string = '';
        if (debugConfiguration.debugAdapterPython !== undefined) {
            logger.info('Found debugAdapterPython on Debug Configuration to use');
            pythonPath = debugConfiguration.debugAdapterPython;
        } else if (debugConfiguration.pythonPath) {
            logger.info('Found pythonPath on Debug Configuration to use');
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
