import { inject, injectable } from 'inversify';
import { ProgressLocation, ConfigurationTarget, Uri, window, workspace, NotebookDocument } from 'vscode';
import { IApplicationShell, ICommandManager } from '../../../common/application/types';
import { traceInfo, traceError } from '../../../common/logger';
import { IConfigurationService, IDisposableRegistry } from '../../../common/types';
import { DataScience } from '../../../common/utils/localize';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Commands, Telemetry } from '../../constants';
import { getNotebookMetadata } from '../../notebook/helpers/helpers';
import { trackKernelResourceInformation, sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import { IDataScienceCommandListener, IInteractiveWindowProvider, INotebookProvider, InterruptResult, IStatusProvider } from '../../types';
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
    ) { }

    public register(commandManager: ICommandManager): void {
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorInterruptKernel, (notebookUri: Uri | undefined) =>
                this.interruptKernel(notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRestartKernel, (notebookUri: Uri | undefined) =>
                this.restartKernel(notebookUri)
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
        const uri = notebookUri ?? window.activeNotebookEditor?.document.uri ?? this.interactiveWindowProvider.activeWindow?.notebookUri;
        const document = workspace.notebookDocuments.find((document) => document.uri.toString() === uri?.toString());

        if (document === undefined) {
            return;
        }

        const kernel = this.kernelProvider.get(document);
        if (!kernel) {
            traceInfo(
                `Interrupt requested & no kernel.`
            );
            trackKernelResourceInformation(document.uri, { interruptKernel: true });
            return;
        }
        const status = this.statusProvider.set(DataScience.interruptKernelStatus(), true, undefined, undefined);

        try {
            traceInfo(`Interrupt requested & sent for ${document.uri} in notebookEditor.`);
            const result = await kernel.interrupt(document);
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
        const uri = notebookUri ?? window.activeNotebookEditor?.document.uri ?? this.interactiveWindowProvider.activeWindow?.notebookUri;
        const document = workspace.notebookDocuments.find((document) => document.uri.toString() === uri?.toString());

        if (document === undefined) {
            return;
        }

        trackKernelResourceInformation(document.uri, { restartKernel: true });
        sendTelemetryEvent(Telemetry.RestartKernelCommand);
        const kernel = this.kernelProvider.get(document);

        if (kernel) {
            if (await this.shouldAskForRestart(document.uri)) {
                // Ask the user if they want us to restart or not.
                const message = DataScience.restartKernelMessage();
                const yes = DataScience.restartKernelMessageYes();
                const dontAskAgain = DataScience.restartKernelMessageDontAskAgain();
                const no = DataScience.restartKernelMessageNo();

                const response = await this.applicationShell.showInformationMessage(message, yes, dontAskAgain, no);
                if (response === dontAskAgain) {
                    await this.disableAskForRestart(document.uri);
                    void this.applicationShell.withProgress(
                        { location: ProgressLocation.Notification, title: DataScience.restartingKernelStatus() },
                        () => this.restartKernelInternal(kernel, document)
                    );
                } else if (response === yes) {
                    void this.applicationShell.withProgress(
                        { location: ProgressLocation.Notification, title: DataScience.restartingKernelStatus() },
                        () => this.restartKernelInternal(kernel, document)
                    );
                }
            } else {
                void this.applicationShell.withProgress(
                    { location: ProgressLocation.Notification, title: DataScience.restartingKernelStatus() },
                    () => this.restartKernelInternal(kernel, document)
                );
            }
        }
    }

    private async restartKernelInternal(kernel: IKernel, notebookDocument: NotebookDocument): Promise<void> {
        // Set our status
        const status = this.statusProvider.set(DataScience.restartingKernelStatus(), true, undefined, undefined);

        const stopWatch = new StopWatch();
        try {
            await kernel.restart(notebookDocument);
            sendKernelTelemetryEvent(notebookDocument.uri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(
                notebookDocument.uri,
                Telemetry.NotebookRestart,
                stopWatch.elapsedTime,
                undefined,
                exc
            );
            if (exc instanceof JupyterKernelPromiseFailedError && kernel) {
                // Old approach (INotebook is not exposed in IKernel, and INotebook will eventually go away).
                const notebook = await this.notebookProvider.getOrCreateNotebook({
                    resource: notebookDocument.uri,
                    identity: notebookDocument.uri,
                    getOnly: true
                });
                if (notebook) {
                    await notebook.dispose();
                }
                await this.notebookProvider.connect({
                    getOnly: false,
                    disableUI: false,
                    resource: notebookDocument.uri,
                    metadata: getNotebookMetadata(notebookDocument)
                });
            } else {
                // Show the error message
                void this.applicationShell.showErrorMessage(exc);
                traceError(exc);
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