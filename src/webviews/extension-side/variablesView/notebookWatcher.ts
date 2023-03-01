// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    NotebookDocument,
    NotebookEditor
} from 'vscode';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { IActiveNotebookChangedEvent, INotebookWatcher } from './types';
import { IInteractiveWindowProvider } from '../../../interactive-window/types';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { IDataViewerFactory } from '../dataviewer/types';
import { JupyterNotebookView } from '../../../platform/common/constants';
import { isJupyterNotebook } from '../../../platform/common/utils';

type KernelStateEventArgs = {
    notebook: NotebookDocument;
    state: KernelState;
    cell?: NotebookCell;
};

enum KernelState {
    executed,
    restarted
}

// For any class that is monitoring the active notebook document, this class will update you
// when the active notebook changes or if the execution count is updated on the active notebook
@injectable()
export class NotebookWatcher implements INotebookWatcher {
    public get onDidChangeActiveNotebook(): Event<IActiveNotebookChangedEvent> {
        return this._onDidChangeActiveNotebook.event;
    }
    public get onDidFinishExecutingActiveNotebook(): Event<{ executionCount: number }> {
        return this._onDidFinisheExecutingActiveNotebook.event;
    }
    public get onDidRestartActiveNotebook(): Event<void> {
        return this._onDidRestartActiveNotebook.event;
    }
    public get activeKernel(): IKernel | undefined {
        const activeNotebook = this.notebooks.activeNotebookEditor?.notebook;
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
        const activeDataViewer = this.dataViewerFactory.activeViewer;
        return activeDataViewer
            ? this.kernelProvider.kernels.find((item) => item === activeDataViewer.kernel)
            : undefined;
    }

    public get activeNotebookExecutionCount(): number | undefined {
        const activeNotebook = this.activeKernel?.notebook;
        return activeNotebook ? this._executionCountTracker.get(activeNotebook) : undefined;
    }

    private readonly _onDidFinisheExecutingActiveNotebook = new EventEmitter<{ executionCount: number }>();
    private readonly _onDidChangeActiveNotebook = new EventEmitter<{
        executionCount?: number;
    }>();
    private readonly _onDidRestartActiveNotebook = new EventEmitter<void>();

    // Keep track of the execution count for any notebook
    private _executionCountTracker = new WeakMap<NotebookDocument, number>();

    constructor(
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDataViewerFactory) private readonly dataViewerFactory: IDataViewerFactory,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook
    ) {
        // We need to know if kernel state changes or if the active notebook editor is changed
        this.notebooks.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, this.disposables);
        this.notebooks.onDidCloseNotebookDocument(this.notebookEditorClosed, this, this.disposables);
        this.kernelProvider.onDidRestartKernel(
            (kernel) => {
                this.handleRestart({ state: KernelState.restarted, notebook: kernel.notebook });
            },
            this,
            this.disposables
        );
        notebooks.onDidChangeNotebookCellExecutionState(
            this.onDidChangeNotebookCellExecutionState,
            this,
            this.disposables
        );
    }
    private getActiveInteractiveWindowDocument() {
        const interactiveWindow = this.interactiveWindowProvider.getActiveOrAssociatedInteractiveWindow();
        if (!interactiveWindow) {
            return;
        }
        return this.notebooks.notebookDocuments.find(
            (notebookDocument) => notebookDocument === interactiveWindow?.notebookDocument
        );
    }

    // Handle when a cell finishes execution
    private onDidChangeNotebookCellExecutionState(cellStateChange: NotebookCellExecutionStateChangeEvent) {
        if (!isJupyterNotebook(cellStateChange.cell.notebook)) {
            return;
        }

        // If a cell has moved to idle, update our state
        if (cellStateChange.state === NotebookCellExecutionState.Idle) {
            // Convert to the old KernelStateEventArgs format
            this.handleExecute({
                notebook: cellStateChange.cell.notebook,
                state: KernelState.executed,
                cell: cellStateChange.cell
            });
        }
    }

    // Handle a kernel execution event
    private handleExecute(kernelStateEvent: KernelStateEventArgs) {
        // We are not interested in silent executions
        if (this.isNonSilentExecution(kernelStateEvent)) {
            // First, update our execution counts, regardless of if this is the active document
            if (kernelStateEvent.cell?.executionSummary?.executionOrder !== undefined) {
                this._executionCountTracker.set(
                    kernelStateEvent.notebook,
                    kernelStateEvent.cell.executionSummary?.executionOrder
                );
            }

            // Next, if this is the active document, send out our notifications
            if (
                this.isActiveNotebookEvent(kernelStateEvent) &&
                kernelStateEvent.cell?.executionSummary?.executionOrder !== undefined
            ) {
                const doneExecuting =
                    this.activeKernel &&
                    this.kernelProvider.getKernelExecution(this.activeKernel).pendingCells.length === 0;
                if (doneExecuting) {
                    this._onDidFinisheExecutingActiveNotebook.fire({
                        executionCount: kernelStateEvent.cell.executionSummary?.executionOrder
                    });
                }
            }
        }
    }

    // Handle a kernel restart event
    private handleRestart(kernelStateEvent: KernelStateEventArgs) {
        // First delete any execution counts that we are holding for this
        this._executionCountTracker.delete(kernelStateEvent.notebook);

        // If this is the active notebook, send our restart message
        if (this.isActiveNotebookEvent(kernelStateEvent)) {
            this._onDidRestartActiveNotebook.fire();
        }
    }

    // When an editor is closed, remove it from our execution count map
    private notebookEditorClosed(doc: NotebookDocument) {
        this._executionCountTracker.delete(doc);
    }

    // When the active editor is changed, update our execution count and notify
    private activeEditorChanged(editor: NotebookEditor | undefined) {
        const changeEvent: IActiveNotebookChangedEvent = {};

        if (editor && isJupyterNotebook(editor.notebook)) {
            const executionCount = this._executionCountTracker.get(editor.notebook);
            executionCount && (changeEvent.executionCount = executionCount);
        }

        this._onDidChangeActiveNotebook.fire(changeEvent);
    }

    // Check to see if this is a non-silent execution that we want to update on
    private isNonSilentExecution(kernelStateEvent: KernelStateEventArgs): boolean {
        if (
            kernelStateEvent.state === KernelState.executed &&
            kernelStateEvent.cell &&
            kernelStateEvent.cell.executionSummary?.executionOrder
        ) {
            return true;
        }

        return false;
    }

    // Check to see if this event was on the active notebook
    private isActiveNotebookEvent(kernelStateEvent: KernelStateEventArgs): boolean {
        return this.activeKernel?.notebook === kernelStateEvent.notebook;
    }
}
