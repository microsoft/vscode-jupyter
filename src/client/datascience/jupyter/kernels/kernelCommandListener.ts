// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { ProgressLocation, ConfigurationTarget, Uri, window, workspace } from 'vscode';
import { IApplicationShell, ICommandManager } from '../../../common/application/types';
import { traceInfo, traceError } from '../../../common/logger';
import { IConfigurationService, IDisposableRegistry } from '../../../common/types';
import { DataScience } from '../../../common/utils/localize';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Commands, Telemetry } from '../../constants';
import { getNotebookMetadata } from '../../notebook/helpers/helpers';
import { trackKernelResourceInformation, sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import {
    IDataScienceCommandListener,
    IInteractiveWindowProvider,
    INotebookProvider,
    InterruptResult,
    IStatusProvider
} from '../../types';
import { JupyterKernelPromiseFailedError } from './jupyterKernelPromiseFailedError';
import { IKernel, IKernelProvider } from './types';

@injectable()
export class KernelCommandListener implements IDataScienceCommandListener {
    private kernelInterruptedDontAskToRestart: boolean = false;

    constructor(
        @inject(IStatusProvider) private statusProvider: IStatusProvider,
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IConfigurationService) private configurationService: IConfigurationService,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider
    ) {}

    public register(commandManager: ICommandManager): void {
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.NotebookEditorInterruptKernel,
                (context?: { notebookEditor: { notebookUri: Uri } } | Uri) => {
                    if (context && 'notebookEditor' in context) {
                        void this.interruptKernel(context?.notebookEditor.notebookUri);
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
                        void this.restartKernel(context?.notebookEditor.notebookUri);
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
                    this.interruptKernel(context?.notebookEditor.notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.RestartKernel,
                (context?: { notebookEditor: { notebookUri: Uri } }) =>
                    this.restartKernel(context?.notebookEditor.notebookUri)
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

        const kernel = this.kernelProvider.get(document);
        if (!kernel) {
            traceInfo(`Interrupt requested & no kernel.`);
            return;
        }
        trackKernelResourceInformation(kernel.resourceUri, { interruptKernel: true });
        const status = this.statusProvider.set(DataScience.interruptKernelStatus());

        try {
            traceInfo(`Interrupt requested & sent for ${document.uri} in notebookEditor.`);
            const result = await kernel.interrupt();
            if (result === InterruptResult.TimedOut) {
                const message = DataScience.restartKernelAfterInterruptMessage();
                const yes = DataScience.restartKernelMessageYes();
                const no = DataScience.restartKernelMessageNo();
                const v = await this.applicationShell.showInformationMessage(message, { modal: true }, yes, no);
                if (v === yes) {
                    this.kernelInterruptedDontAskToRestart = true;
                    await this.restartKernel(document.uri);
                }
            }
        } catch (err) {
            traceError('Failed to interrupt kernel', err);
            void this.applicationShell.showErrorMessage(err);
        } finally {
            this.kernelInterruptedDontAskToRestart = false;
            status.dispose();
        }
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
        const kernel = this.kernelProvider.get(document);

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
                    void this.applicationShell.withProgress(
                        { location: ProgressLocation.Notification, title: DataScience.restartingKernelStatus() },
                        () => this.restartKernelInternal(kernel)
                    );
                } else if (response === yes) {
                    void this.applicationShell.withProgress(
                        { location: ProgressLocation.Notification, title: DataScience.restartingKernelStatus() },
                        () => this.restartKernelInternal(kernel)
                    );
                }
            } else {
                void this.applicationShell.withProgress(
                    { location: ProgressLocation.Notification, title: DataScience.restartingKernelStatus() },
                    () => this.restartKernelInternal(kernel)
                );
            }
        }
    }

    private async restartKernelInternal(kernel: IKernel): Promise<void> {
        // Set our status
        const status = this.statusProvider.set(DataScience.restartingKernelStatus());

        const stopWatch = new StopWatch();
        try {
            await kernel.restart();
            sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(
                kernel.resourceUri,
                Telemetry.NotebookRestart,
                stopWatch.elapsedTime,
                undefined,
                exc
            );
            if (exc instanceof JupyterKernelPromiseFailedError && kernel) {
                // Old approach (INotebook is not exposed in IKernel, and INotebook will eventually go away).
                const notebook = await this.notebookProvider.getOrCreateNotebook({
                    resource: kernel.resourceUri,
                    document: kernel.notebookDocument,
                    getOnly: true
                });
                if (notebook) {
                    await notebook.dispose();
                }
                await this.notebookProvider.connect({
                    getOnly: false,
                    disableUI: false,
                    resource: kernel.resourceUri,
                    metadata: getNotebookMetadata(kernel.notebookDocument)
                });
            } else {
                traceError('Failed to restart the kernel', exc);
                if (exc) {
                    // Show the error message
                    void this.applicationShell.showErrorMessage(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        exc instanceof Error ? exc.message : (exc as any).toString()
                    );
                }
            }
        } finally {
            status.dispose();
        }
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
