// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { ConfigurationTarget, Uri, window, workspace } from 'vscode';
import { IApplicationShell, ICommandManager } from '../platform/common/application/types';
import { endCellAndDisplayErrorsInCell } from '../platform/errors/errorUtils';
import { traceInfo, traceInfoIfCI } from '../platform/logging';
import { IDisposableRegistry, IConfigurationService, IDataScienceCommandListener } from '../platform/common/types';
import { DataScience } from '../platform/common/utils/localize';
import { INotebookControllerManager } from '../notebooks/types';
import { trackKernelResourceInformation } from '../telemetry/telemetry';
import { IServiceContainer } from '../platform/ioc/types';
import { sendTelemetryEvent } from '../telemetry';
import { Commands, Telemetry } from '../webviews/webview-side/common/constants';
import { IKernel, IKernelProvider } from './types';
import { IInteractiveWindowProvider } from '../interactive-window/types';
import { IDataScienceErrorHandler } from '../platform/errors/types';
import { getAssociatedNotebookDocument } from '../notebooks/controllers/kernelSelector';
import { DisplayOptions } from './displayOptions';
import { KernelConnector } from './kernelConnector';
import { getDisplayPath } from '../platform/common/platform/fs-paths';

@injectable()
export class KernelCommandListener implements IDataScienceCommandListener {
    private kernelInterruptedDontAskToRestart: boolean = false;

    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IConfigurationService) private configurationService: IConfigurationService,
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(INotebookControllerManager) private notebookControllerManager: INotebookControllerManager,
        @inject(IDataScienceErrorHandler) private errorHandler: IDataScienceErrorHandler
    ) {}

    public register(commandManager: ICommandManager): void {
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.NotebookEditorInterruptKernel,
                (context?: { notebookEditor: { notebookUri: Uri } } | Uri) => {
                    if (context && 'notebookEditor' in context) {
                        void this.interruptKernel(context?.notebookEditor?.notebookUri);
                    } else {
                        void this.interruptKernel(context);
                    }
                }
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.NotebookEditorRestartKernel,
                (context?: { notebookEditor: { notebookUri: Uri } } | Uri) => {
                    if (context && 'notebookEditor' in context) {
                        void this.restartKernel(context?.notebookEditor?.notebookUri);
                    } else {
                        void this.restartKernel(context);
                    }
                }
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.InterruptKernel,
                (context?: { notebookEditor: { notebookUri: Uri } }) =>
                    this.interruptKernel(context?.notebookEditor?.notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.RestartKernel,
                (context?: { notebookEditor: { notebookUri: Uri } }) =>
                    this.restartKernel(context?.notebookEditor?.notebookUri)
            )
        );
    }

    public async interruptKernel(notebookUri: Uri | undefined): Promise<void> {
        const uri =
            notebookUri ??
            window.activeNotebookEditor?.document.uri ??
            this.interactiveWindowProvider.activeWindow?.notebookUri ??
            (window.activeTextEditor?.document.uri &&
                this.interactiveWindowProvider.get(window.activeTextEditor.document.uri)?.notebookUri);
        const document = workspace.notebookDocuments.find((document) => document.uri.toString() === uri?.toString());

        if (document === undefined) {
            return;
        }
        traceInfoIfCI(`Interrupt kernel command handler for ${getDisplayPath(document.uri)}`);

        const kernel = this.kernelProvider.get(document.uri);
        if (!kernel) {
            traceInfo(`Interrupt requested & no kernel.`);
            return;
        }
        await this.wrapKernelMethod('interrupt', kernel);
    }

    private async restartKernel(notebookUri: Uri | undefined) {
        const uri =
            notebookUri ??
            window.activeNotebookEditor?.document.uri ??
            this.interactiveWindowProvider.activeWindow?.notebookUri ??
            (window.activeTextEditor?.document.uri &&
                this.interactiveWindowProvider.get(window.activeTextEditor.document.uri)?.notebookUri);
        const document = workspace.notebookDocuments.find((document) => document.uri.toString() === uri?.toString());

        if (document === undefined) {
            return;
        }

        sendTelemetryEvent(Telemetry.RestartKernelCommand);
        const kernel = this.kernelProvider.get(document.uri);

        if (kernel) {
            trackKernelResourceInformation(kernel.resourceUri, { restartKernel: true });
            if (await this.shouldAskForRestart(document.uri)) {
                // Ask the user if they want us to restart or not.
                const message = DataScience.restartKernelMessage();
                const yes = DataScience.restartKernelMessageYes();
                const dontAskAgain = DataScience.restartKernelMessageDontAskAgain();
                const no = DataScience.restartKernelMessageNo();

                const response = await this.applicationShell.showInformationMessage(
                    message,
                    { modal: true },
                    yes,
                    dontAskAgain,
                    no
                );
                if (response === dontAskAgain) {
                    await this.disableAskForRestart(document.uri);
                    void this.wrapKernelMethod('restart', kernel);
                } else if (response === yes) {
                    void this.wrapKernelMethod('restart', kernel);
                }
            } else {
                void this.wrapKernelMethod('restart', kernel);
            }
        }
    }

    private readonly pendingRestartInterrupt = new WeakMap<IKernel, Promise<void>>();
    private async wrapKernelMethod(currentContext: 'interrupt' | 'restart', kernel: IKernel) {
        const notebook = getAssociatedNotebookDocument(kernel);
        if (!notebook) {
            throw new Error('Unable to start a kernel that is not attached to a notebook document');
        }
        // We don't want to create multiple restarts/interrupt requests for the same kernel.
        const pendingPromise = this.pendingRestartInterrupt.get(kernel);
        if (pendingPromise) {
            return pendingPromise;
        }
        const promise = (async () => {
            // Get currently executing cell and controller
            const currentCell = kernel.pendingCells[0];
            const controller = this.notebookControllerManager.getSelectedNotebookController(notebook);
            try {
                if (!controller) {
                    throw new Error('No kernel associated with the notebook');
                }
                // Wrap the restart/interrupt in a loop that allows the user to switch
                await KernelConnector.wrapKernelMethod(
                    controller.controller,
                    controller.connection,
                    currentContext,
                    this.serviceContainer,
                    kernel.resourceUri,
                    notebook,
                    new DisplayOptions(false),
                    this.disposableRegistry
                );
            } catch (ex) {
                if (currentCell) {
                    await endCellAndDisplayErrorsInCell(
                        currentCell,
                        kernel.controller,
                        await this.errorHandler.getErrorMessageForDisplayInCell(ex, currentContext),
                        false
                    );
                } else {
                    void this.applicationShell.showErrorMessage(ex.toString());
                }
            }
        })();
        promise.finally(() => {
            if (this.pendingRestartInterrupt.get(kernel) === promise) {
                this.pendingRestartInterrupt.delete(kernel);
            }
        });
        this.pendingRestartInterrupt.set(kernel, promise);
        return promise;
    }

    private async shouldAskForRestart(notebookUri: Uri): Promise<boolean> {
        if (this.kernelInterruptedDontAskToRestart) {
            return false;
        }
        const settings = this.configurationService.getSettings(notebookUri);
        return settings && settings.askForKernelRestart === true;
    }

    private async disableAskForRestart(notebookUri: Uri): Promise<void> {
        const settings = this.configurationService.getSettings(notebookUri);
        if (settings) {
            this.configurationService
                .updateSetting('askForKernelRestart', false, undefined, ConfigurationTarget.Global)
                .ignoreErrors();
        }
    }
}
