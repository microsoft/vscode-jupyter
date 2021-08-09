// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import {
    ConfigurationTarget,
    Event,
    EventEmitter,
    NotebookCellKind,
    NotebookRange,
    NotebookDocument,
    ProgressLocation,
    Uri,
    NotebookCellData,
    NotebookCell,
    NotebookData
} from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { traceError, traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, IExtensions } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { isUntitledFile, noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import { JupyterKernelPromiseFailedError } from '../jupyter/kernels/jupyterKernelPromiseFailedError';
import { IKernel, IKernelProvider } from '../jupyter/kernels/types';
import { INotebook, INotebookEditor, INotebookProvider, InterruptResult, IStatusProvider } from '../types';
import { NotebookCellLanguageService } from './cellLanguageService';
import { chainWithPendingUpdates } from './helpers/notebookUpdater';
import { getNotebookMetadata } from './helpers/helpers';
import type { nbformat } from '@jupyterlab/coreutils';

export class NotebookEditor implements INotebookEditor {
    public get closed(): Event<INotebookEditor> {
        return this._closed.event;
    }
    public get modified(): Event<INotebookEditor> {
        return this._modified.event;
    }
    public get saved(): Event<INotebookEditor> {
        return this._saved.event;
    }
    public get isUntitled(): boolean {
        return isUntitledFile(this.document.uri);
    }
    public get isDirty(): boolean {
        return this.document.isDirty;
    }
    public get file(): Uri {
        return this.document.uri;
    }
    public notebook?: INotebook | undefined;

    private _closed = new EventEmitter<INotebookEditor>();
    private _saved = new EventEmitter<INotebookEditor>();
    private _modified = new EventEmitter<INotebookEditor>();
    private restartingKernel?: boolean;
    private kernelInterruptedDontAskToRestart: boolean = false;
    constructor(
        public readonly document: NotebookDocument,
        private readonly vscodeNotebook: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        private readonly notebookProvider: INotebookProvider,
        private readonly kernelProvider: IKernelProvider,
        private readonly statusProvider: IStatusProvider,
        private readonly applicationShell: IApplicationShell,
        private readonly configurationService: IConfigurationService,
        disposables: IDisposableRegistry,
        private readonly cellLanguageService: NotebookCellLanguageService,
        private extensions: IExtensions
    ) {
        vscodeNotebook.onDidCloseNotebookDocument(this.onClosedDocument, this, disposables);
    }
    executed?: Event<INotebookEditor> | undefined;
    public get notebookMetadata(): nbformat.INotebookMetadata | undefined {
        return getNotebookMetadata(this.document);
    }
    onExecutedCode?: Event<string> | undefined;
    public getContent(): string {
        const serializerApi = this.extensions.getExtension<{ exportNotebook: (notebook: NotebookData) => string }>(
            'vscode.ipynb'
        );
        if (!serializerApi) {
            throw new Error(
                'Unable to export notebook as the built-in vscode.ipynb extension is currently unavailable.'
            );
        }
        const cells = this.document.getCells();
        const cellData = cells.map((c) => {
            const data = new NotebookCellData(c.kind, c.document.getText(), c.document.languageId);
            data.metadata = c.metadata;
            data.mime = c.mime;
            data.outputs = [...c.outputs];
            return data;
        });
        const notebookData = new NotebookData(cellData);
        notebookData.metadata = this.document.metadata;
        return serializerApi.exports.exportNotebook(notebookData);
    }
    @captureTelemetry(Telemetry.SyncAllCells)
    public async syncAllCells(): Promise<void> {
        // This shouldn't be necessary for native notebooks. if it is, it's because the document
        // is not up to date (VS code issue)
    }
    public runAllCells(): void {
        this.commandManager.executeCommand('notebook.execute').then(noop, noop);
    }
    public addCellBelow(): void {
        this.commandManager.executeCommand('notebook.cell.insertCodeCellBelow').then(noop, noop);
    }
    public startProgress(): void {
        throw new Error('Method not implemented.');
    }
    public stopProgress(): void {
        throw new Error('Method not implemented.');
    }
    public createWebviewCellButton(): IDisposable {
        return {
            dispose: () => noop()
        };
    }
    public hasCell(): Promise<boolean> {
        return Promise.resolve(this.document.cellCount > 0);
    }
    public undoCells(): void {
        this.commandManager.executeCommand('notebook.undo').then(noop, noop);
    }
    public redoCells(): void {
        this.commandManager.executeCommand('notebook.redo').then(noop, noop);
    }
    public toggleOutput(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }

        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            const cells: NotebookCell[] = [];
            editor.selections.map((cr) => {
                if (!cr.isEmpty) {
                    for (let index = cr.start; index < cr.end; index++) {
                        cells.push(editor.document.cellAt(index));
                    }
                }
            });
            chainWithPendingUpdates(editor.document, (edit) => {
                cells.forEach((cell) => {
                    const collapsed = cell.metadata.outputCollapsed || false;
                    const metadata = { ...cell.metadata, outputCollapsed: !collapsed };
                    edit.replaceNotebookCellMetadata(editor.document.uri, cell.index, metadata);
                });
            }).then(noop, noop);
        }
    }
    public removeAllCells(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }
        const defaultLanguage = this.cellLanguageService.getPreferredLanguage(getNotebookMetadata(this.document));
        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            chainWithPendingUpdates(editor.document, (edit) =>
                edit.replaceNotebookCells(editor.document.uri, new NotebookRange(0, this.document.cellCount), [
                    new NotebookCellData(NotebookCellKind.Code, '', defaultLanguage)
                ])
            ).then(noop, noop);
        }
    }
    public expandAllCells(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }
        const notebook = this.vscodeNotebook.activeNotebookEditor.document;
        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            chainWithPendingUpdates(editor.document, (edit) => {
                notebook.getCells().forEach((cell, index) => {
                    const metadata = { ...(cell.metadata || {}), inputCollapsed: false, outputCollapsed: false };
                    edit.replaceNotebookCellMetadata(editor.document.uri, index, metadata);
                });
            }).then(noop, noop);
        }
    }
    public collapseAllCells(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }
        const notebook = this.vscodeNotebook.activeNotebookEditor.document;
        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            chainWithPendingUpdates(editor.document, (edit) => {
                notebook.getCells().forEach((cell, index) => {
                    const metadata = { ...(cell.metadata || {}), inputCollapsed: true, outputCollapsed: true };
                    edit.replaceNotebookCellMetadata(editor.document.uri, index, metadata);
                });
            }).then(noop, noop);
        }
    }
    public async interruptKernel(): Promise<void> {
        if (this.restartingKernel) {
            traceInfo(`Interrupt requested & currently restarting ${this.document.uri} in notebookEditor.`);
            trackKernelResourceInformation(this.document.uri, { interruptKernel: true });
            return;
        }
        const kernel = this.kernelProvider.get(this.document);
        if (!kernel || this.restartingKernel) {
            traceInfo(
                `Interrupt requested & no kernel or currently restarting ${this.document.uri} in notebookEditor.`
            );
            trackKernelResourceInformation(this.document.uri, { interruptKernel: true });
            return;
        }
        const status = this.statusProvider.set(DataScience.interruptKernelStatus(), true, undefined, undefined);

        try {
            traceInfo(`Interrupt requested & sent for ${this.document.uri} in notebookEditor.`);
            const result = await kernel.interrupt(this.document);
            if (result === InterruptResult.TimedOut) {
                const message = DataScience.restartKernelAfterInterruptMessage();
                const yes = DataScience.restartKernelMessageYes();
                const no = DataScience.restartKernelMessageNo();
                const v = await this.applicationShell.showInformationMessage(message, { modal: true }, yes, no);
                if (v === yes) {
                    this.restartingKernel = false;
                    this.kernelInterruptedDontAskToRestart = true;
                    await this.restartKernel();
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

    public async restartKernel(): Promise<void> {
        trackKernelResourceInformation(this.document.uri, { restartKernel: true });
        sendTelemetryEvent(Telemetry.RestartKernelCommand);
        if (this.restartingKernel) {
            trackKernelResourceInformation(this.document.uri, { restartKernel: true });
            return;
        }
        const kernel = this.kernelProvider.get(this.document);

        if (kernel && !this.restartingKernel) {
            if (await this.shouldAskForRestart()) {
                // Ask the user if they want us to restart or not.
                const message = DataScience.restartKernelMessage();
                const yes = DataScience.restartKernelMessageYes();
                const dontAskAgain = DataScience.restartKernelMessageDontAskAgain();
                const no = DataScience.restartKernelMessageNo();

                const response = await this.applicationShell.showInformationMessage(message, yes, dontAskAgain, no);
                if (response === dontAskAgain) {
                    await this.disableAskForRestart();
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
    public dispose() {
        this._closed.fire(this);
    }

    private onClosedDocument(e?: NotebookDocument) {
        if (this.document === e) {
            this._closed.fire(this);
        }
    }

    private async restartKernelInternal(kernel: IKernel): Promise<void> {
        this.restartingKernel = true;

        // Set our status
        const status = this.statusProvider.set(DataScience.restartingKernelStatus(), true, undefined, undefined);

        const stopWatch = new StopWatch();
        try {
            await kernel.restart(this.document);
            sendKernelTelemetryEvent(this.document.uri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(
                this.document.uri,
                Telemetry.NotebookRestart,
                stopWatch.elapsedTime,
                undefined,
                exc
            );
            if (exc instanceof JupyterKernelPromiseFailedError && kernel) {
                // Old approach (INotebook is not exposed in IKernel, and INotebook will eventually go away).
                const notebook = await this.notebookProvider.getOrCreateNotebook({
                    resource: this.file,
                    identity: this.file,
                    getOnly: true
                });
                if (notebook) {
                    await notebook.dispose();
                }
                await this.notebookProvider.connect({
                    getOnly: false,
                    disableUI: false,
                    resource: this.file,
                    metadata: getNotebookMetadata(this.document)
                });
            } else {
                // Show the error message
                void this.applicationShell.showErrorMessage(exc);
                traceError(exc);
            }
        } finally {
            status.dispose();
            this.restartingKernel = false;
        }
    }
    private async shouldAskForRestart(): Promise<boolean> {
        if (this.kernelInterruptedDontAskToRestart) {
            return false;
        }
        const settings = this.configurationService.getSettings(this.file);
        return settings && settings.askForKernelRestart === true;
    }

    private async disableAskForRestart(): Promise<void> {
        const settings = this.configurationService.getSettings(this.file);
        if (settings) {
            this.configurationService
                .updateSetting('askForKernelRestart', false, undefined, ConfigurationTarget.Global)
                .ignoreErrors();
        }
    }
}
