// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { ProgressLocation, ConfigurationTarget, Uri, window, workspace } from 'vscode';
import { IApplicationShell, ICommandManager } from '../../../common/application/types';
import { traceInfo, traceError } from '../../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry } from '../../../common/types';
import { DataScience } from '../../../common/utils/localize';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Commands, Telemetry } from '../../constants';
import { RawJupyterSession } from '../../raw-kernel/rawJupyterSession';
import { trackKernelResourceInformation, sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import {
    IDataScienceCommandListener,
    IDataScienceErrorHandler,
    IInteractiveWindowProvider,
    InterruptResult,
    IStatusProvider
} from '../../types';
import { JupyterSession } from '../jupyterSession';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernel, IKernelProvider } from './types';

@injectable()
export class KernelCommandListener implements IDataScienceCommandListener {
    private kernelInterruptedDontAskToRestart: boolean = false;
    private kernelsStartedSuccessfully = new WeakSet<IKernel>();
    private kernelRestartProgress = new WeakMap<IKernel, IDisposable>();

    constructor(
        @inject(IStatusProvider) private statusProvider: IStatusProvider,
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IConfigurationService) private configurationService: IConfigurationService,
        @inject(IDataScienceErrorHandler) private errorHandler: IDataScienceErrorHandler
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
        this.disposableRegistry.push(this.kernelProvider.onKernelStatusChanged(this.onKernelStatusChanged, this));
        this.disposableRegistry.push(this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this));
        this.disposableRegistry.push(
            this.kernelProvider.onDidDisposeKernel((kernel) => {
                this.kernelRestartProgress.get(kernel)?.dispose();
                this.kernelRestartProgress.delete(kernel);
            }, this)
        );
        this.disposableRegistry.push(
            this.kernelProvider.onDidRestartKernel((kernel) => {
                this.kernelRestartProgress.get(kernel)?.dispose();
                this.kernelRestartProgress.delete(kernel);
            }, this)
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

        let errorContext: 'interrupt' | 'restart' = 'interrupt';
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
                    errorContext = 'restart';
                    await this.restartKernel(document.uri);
                }
            }
        } catch (err) {
            traceError('Failed to interrupt kernel', err);
            void this.errorHandler.handleKernelError(err, errorContext, kernel.kernelConnectionMetadata);
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
            traceError('Failed to restart the kernel', exc);
            void this.errorHandler.handleKernelError(exc, 'restart', kernel.kernelConnectionMetadata);
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
    private onDidStartKernel(kernel: IKernel) {
        this.kernelsStartedSuccessfully.add(kernel);
    }
    private onKernelStatusChanged({ kernel }: { status: KernelMessage.Status; kernel: IKernel }) {
        // We're only interested in kernels that started successfully.
        if (!this.kernelsStartedSuccessfully.has(kernel)) {
            return;
        }

        // If this kernel is still active & we're using raw kernels,
        // and the session has died, then notify the user of this dead kernel.
        // Note: We know this kernel started successfully.
        if (
            kernel?.session &&
            kernel?.session instanceof RawJupyterSession &&
            kernel.status === 'dead' &&
            !kernel.disposed &&
            !kernel.disposing
        ) {
            void this.applicationShell.showErrorMessage(
                DataScience.kernelDiedWithoutError().format(
                    getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
                )
            );
        }

        // If this is a Jupyter kernel (non-raw or remote jupyter), & kernel is restarting
        // then display a progress message indicating its restarting.
        // The user needs to know that its automatically restarting (they didn't explicitly restart the kernel).
        if (kernel.status === 'autorestarting' && kernel.session && kernel.session instanceof JupyterSession) {
            // Set our status
            const status = this.statusProvider.set(DataScience.restartingKernelStatus());
            this.kernelRestartProgress.set(kernel, status);
        } else if (kernel.status !== 'starting' && kernel.status !== 'busy' && kernel.status !== 'unknown') {
            this.kernelRestartProgress.get(kernel)?.dispose();
            this.kernelRestartProgress.delete(kernel);
        }
    }
}
