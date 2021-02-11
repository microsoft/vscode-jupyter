// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ConfigurationTarget, Event, EventEmitter, ProgressLocation, Uri, WebviewPanel } from 'vscode';
import { NotebookCell, NotebookDocument } from '../../../../types/vscode-proposed';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { CancellationError } from '../../common/cancellation';
import { isErrorType } from '../../common/errors/errorUtils';
import { traceError } from '../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import { JupyterKernelPromiseFailedError } from '../jupyter/kernels/jupyterKernelPromiseFailedError';
import { IKernel, IKernelProvider } from '../jupyter/kernels/types';
import {
    INotebook,
    INotebookEditor,
    INotebookModel,
    INotebookProvider,
    InterruptResult,
    IStatusProvider
} from '../types';
import { NotebookCellLanguageService } from './defaultCellLanguageService';
import { chainWithPendingUpdates } from './helpers/notebookUpdater';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

export class NotebookEditor implements INotebookEditor {
    public get onDidChangeViewState(): Event<void> {
        return this.changedViewState.event;
    }
    public get closed(): Event<INotebookEditor> {
        return this._closed.event;
    }
    public get modified(): Event<INotebookEditor> {
        return this._modified.event;
    }

    public get executed(): Event<INotebookEditor> {
        return this._executed.event;
    }
    public get saved(): Event<INotebookEditor> {
        return this._saved.event;
    }
    public get isUntitled(): boolean {
        return this.model.isUntitled;
    }
    public get isDirty(): boolean {
        return this.document.isDirty;
    }
    public get file(): Uri {
        return this.model.file;
    }
    public get visible(): boolean {
        return !this.model.isDisposed;
    }
    public get active(): boolean {
        return this.vscodeNotebook.activeNotebookEditor?.document.uri.toString() === this.model.file.toString();
    }
    public get onExecutedCode(): Event<string> {
        return this.executedCode.event;
    }
    public readonly type = 'native';
    public notebook?: INotebook | undefined;

    private changedViewState = new EventEmitter<void>();
    private _closed = new EventEmitter<INotebookEditor>();
    private _saved = new EventEmitter<INotebookEditor>();
    private _executed = new EventEmitter<INotebookEditor>();
    private _modified = new EventEmitter<INotebookEditor>();
    private executedCode = new EventEmitter<string>();
    private restartingKernel?: boolean;
    constructor(
        public readonly model: INotebookModel,
        public readonly document: NotebookDocument,
        private readonly vscodeNotebook: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        private readonly notebookProvider: INotebookProvider,
        private readonly kernelProvider: IKernelProvider,
        private readonly statusProvider: IStatusProvider,
        private readonly applicationShell: IApplicationShell,
        private readonly configurationService: IConfigurationService,
        disposables: IDisposableRegistry,
        private readonly cellLanguageService: NotebookCellLanguageService
    ) {
        disposables.push(model.onDidEdit(() => this._modified.fire(this)));
        disposables.push(
            model.changed((e) => {
                if (e.kind === 'save') {
                    this._saved.fire(this);
                }
            })
        );
        disposables.push(model.onDidDispose(this._closed.fire.bind(this._closed, this)));
    }
    @captureTelemetry(Telemetry.SyncAllCells)
    public async syncAllCells(): Promise<void> {
        // This shouldn't be necessary for native notebooks. if it is, it's because the document
        // is not up to date (VS code issue)
    }
    public async load(_storage: INotebookModel, _webViewPanel?: WebviewPanel): Promise<void> {
        // Not used.
    }
    public runAllCells(): void {
        this.commandManager.executeCommand('notebook.execute').then(noop, noop);
    }
    public runSelectedCell(): void {
        this.commandManager.executeCommand('notebook.cell.execute').then(noop, noop);
    }
    public addCellBelow(): void {
        this.commandManager.executeCommand('notebook.cell.insertCodeCellBelow').then(noop, noop);
    }
    public show(): Promise<void> {
        throw new Error('Method not implemented.');
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
        return Promise.resolve(this.document.cells.length > 0);
    }
    public undoCells(): void {
        this.commandManager.executeCommand('notebook.undo').then(noop, noop);
    }
    public redoCells(): void {
        this.commandManager.executeCommand('notebook.redo').then(noop, noop);
    }
    public removeAllCells(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }
        const defaultLanguage = this.cellLanguageService.getPreferredLanguage(this.model.metadata);
        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            chainWithPendingUpdates(editor, (edit) =>
                edit.replaceCells(0, this.document.cells.length, [
                    {
                        cellKind: vscodeNotebookEnums.CellKind.Code,
                        language: defaultLanguage,
                        metadata: {},
                        outputs: [],
                        source: ''
                    }
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
            chainWithPendingUpdates(editor, (edit) => {
                notebook.cells.forEach((cell, index) => {
                    edit.replaceCellMetadata(index, {
                        ...cell.metadata,
                        inputCollapsed: false,
                        outputCollapsed: false
                    });
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
            chainWithPendingUpdates(editor, (edit) => {
                notebook.cells.forEach((cell, index) => {
                    edit.replaceCellMetadata(index, {
                        ...cell.metadata,
                        inputCollapsed: true,
                        outputCollapsed: true
                    });
                });
            }).then(noop, noop);
        }
    }
    public notifyExecution(cell: NotebookCell) {
        this._executed.fire(this);
        this.executedCode.fire(cell.document.getText());
    }
    public async interruptKernel(): Promise<void> {
        if (this.restartingKernel) {
            trackKernelResourceInformation(this.document.uri, { interruptKernel: true });
            return;
        }
        const kernel = this.kernelProvider.get(this.file);
        if (!kernel || this.restartingKernel) {
            trackKernelResourceInformation(this.document.uri, { interruptKernel: true });
            return;
        }
        const status = this.statusProvider.set(DataScience.interruptKernelStatus(), true, undefined, undefined);

        try {
            const result = await kernel.interrupt(this.document);
            if (result === InterruptResult.TimedOut) {
                const message = DataScience.restartKernelAfterInterruptMessage();
                const yes = DataScience.restartKernelMessageYes();
                const no = DataScience.restartKernelMessageNo();
                const v = await this.applicationShell.showInformationMessage(message, yes, no);
                if (v === yes) {
                    this.restartingKernel = false;
                    await this.restartKernel();
                }
            }
        } catch (err) {
            traceError('Failed to interrupt kernel', err);
            void this.applicationShell.showErrorMessage(err);
        } finally {
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
        const kernel = this.kernelProvider.get(this.file);

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

    public runAbove(uri: Uri | undefined): void {
        const cellId = this.getSelectedCellId(uri);
        const index = this.document.cells.findIndex((c) => c.uri.toString() === cellId);

        if (index > 0) {
            // Get all cellIds until `index`.
            const cells = this.document.cells.slice(0, index).map((cell) => cell);
            this.runCellRange(cells);
        }
    }
    public runCellAndBelow(uri: Uri | undefined): void {
        const cellId = this.getSelectedCellId(uri);
        const index = this.document.cells.findIndex((c) => c.uri.toString() === cellId);

        if (index >= 0) {
            // Get all cellIds starting from `index`.
            const cells = this.document.cells.slice(index).map((cell) => cell);
            this.runCellRange(cells);
        }
    }

    private getSelectedCellId(uri: Uri | undefined): string | undefined {
        const uriStr = uri ? uri.toString() : this.document.uri.toString();
        const editor = this.vscodeNotebook.notebookEditors.find((nb) => nb.document.uri.toString() === uriStr);

        if (editor && editor.selection) {
            return editor.selection.uri.toString();
        }

        return undefined;
    }

    private runCellRange(cells: NotebookCell[]) {
        const kernel = this.kernelProvider.get(this.file);

        if (!kernel || this.restartingKernel) {
            return;
        }

        cells.forEach(async (cell) => {
            if (cell.cellKind === vscodeNotebookEnums.CellKind.Code) {
                await kernel.executeCell(cell);
            }
        });
    }

    private async restartKernelInternal(kernel: IKernel): Promise<void> {
        this.restartingKernel = true;

        // Set our status
        const status = this.statusProvider.set(DataScience.restartingKernelStatus(), true, undefined, undefined);

        const stopWatch = new StopWatch();
        try {
            await kernel.restart();
            sendKernelTelemetryEvent(this.document.uri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            if (exc instanceof JupyterKernelPromiseFailedError && kernel) {
                sendKernelTelemetryEvent(this.document.uri, Telemetry.NotebookRestart, stopWatch.elapsedTime, {
                    failed: true,
                    failureCategory: 'kernelpromisetimeout'
                });
                // Old approach (INotebook is not exposed in IKernel, and INotebook will eventually go away).
                const notebook = await this.notebookProvider.getOrCreateNotebook({
                    resource: this.file,
                    identity: this.file,
                    getOnly: true
                });
                if (notebook) {
                    await notebook.dispose();
                }
                await this.notebookProvider.connect({ getOnly: false, disableUI: false });
            } else {
                sendKernelTelemetryEvent(this.document.uri, Telemetry.NotebookRestart, stopWatch.elapsedTime, {
                    failed: true,
                    failureCategory: isErrorType(exc, CancellationError) ? 'cancelled' : 'unknown'
                });
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
