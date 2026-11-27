// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    NotebookCell,
    NotebookCellExecution,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookDocument,
    workspace
} from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { isJupyterNotebook } from '../../platform/common/utils';
import { generateUuid } from '../../platform/common/uuid';

export interface TrackedDisplayOutput {
    readonly cell: NotebookCell;
    readonly displayId: string;
    readonly trackingId: string;
    outputContainer: NotebookCellOutput;
    outputItems?: NotebookCellOutputItem[];
    pendingOutputMetadata?: { value: NotebookCellOutput['metadata'] };
    observed: boolean;
    pendingWriter?: NotebookCellExecution;
    deferredUpdate?: { run: () => void; dispose: () => void };
}

type OutputLookup = Map<string, NotebookCellOutput | null>;

function getOutputTrackingId(output: NotebookCellOutput): string | undefined {
    const metadata: unknown = output.metadata?._vscode;
    if (metadata && typeof metadata === 'object' && 'trackingId' in metadata) {
        return typeof metadata.trackingId === 'string' ? metadata.trackingId : undefined;
    }
}

function indexTrackedOutputs(outputs: readonly NotebookCellOutput[], trackingIds: ReadonlySet<string>): OutputLookup {
    const matches: OutputLookup = new Map();
    for (const output of outputs) {
        const id = getOutputTrackingId(output);
        if (id !== undefined && trackingIds.has(id)) {
            matches.set(id, matches.has(id) ? null : output);
        }
    }
    return matches;
}

/**
 * Tracks the concrete output currently addressed by each Jupyter display id.
 */
@injectable()
export class CellOutputDisplayIdTracker implements IExtensionSyncActivationService {
    private static byNotebook = new WeakMap<NotebookDocument, Map<string, TrackedDisplayOutput>>();
    private static byCell = new WeakMap<NotebookCell, Set<TrackedDisplayOutput>>();
    private static disposables: IDisposable[] = [];

    public static dispose() {
        this.disposables = dispose(this.disposables);
        for (const notebook of workspace.notebookDocuments) {
            this.retireNotebook(notebook);
        }
        this.byNotebook = new WeakMap();
        this.byCell = new WeakMap();
    }

    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push({
            dispose: () => {
                CellOutputDisplayIdTracker.dispose();
            }
        });
    }

    public activate(): void {
        const tracker = CellOutputDisplayIdTracker;
        const changeListener = workspace.onDidChangeNotebookDocument((e) => {
            if (!isJupyterNotebook(e.notebook)) {
                return;
            }
            let addedCells: Set<NotebookCell> | undefined;
            for (const change of e.contentChanges) {
                for (const cell of change.removedCells) {
                    if (!tracker.byCell.has(cell)) {
                        continue;
                    }
                    if (!addedCells) {
                        addedCells = new Set();
                        for (const contentChange of e.contentChanges) {
                            for (const added of contentChange.addedCells) {
                                addedCells.add(added);
                            }
                        }
                    }
                    if (!addedCells.has(cell)) {
                        tracker.retireCell(cell);
                    }
                }
            }
            for (const change of e.cellChanges) {
                if (change.outputs !== undefined && tracker.byCell.has(change.cell)) {
                    tracker.observeSnapshot(change.cell, change.outputs);
                }
            }
        });
        const closeListener = workspace.onDidCloseNotebookDocument((notebook) => {
            tracker.retireNotebook(notebook);
        });
        tracker.disposables.push(changeListener, closeListener);
    }

    /**
     * Register immediately before submitting a tagged output to its actual destination.
     */
    public static trackOutputByDisplayId(
        cell: NotebookCell,
        displayId: string,
        outputContainer: NotebookCellOutput,
        writer: NotebookCellExecution
    ): TrackedDisplayOutput {
        let outputs = this.byNotebook.get(cell.notebook);
        if (!outputs) {
            outputs = new Map<string, TrackedDisplayOutput>();
            this.byNotebook.set(cell.notebook, outputs);
        }
        const previous = outputs.get(displayId);
        if (previous) {
            this.retireOutput(previous);
        }

        const trackingId = generateUuid();
        const existingVSCodeMetadata: unknown = outputContainer.metadata?._vscode;
        outputContainer.metadata = {
            ...outputContainer.metadata,
            _vscode: {
                ...(existingVSCodeMetadata && typeof existingVSCodeMetadata === 'object' ? existingVSCodeMetadata : {}),
                trackingId
            }
        };
        const output: TrackedDisplayOutput = {
            cell,
            displayId,
            trackingId,
            outputContainer,
            outputItems: outputContainer.items,
            observed: false,
            pendingWriter: writer
        };
        outputs.set(displayId, output);
        let cellOutputs = this.byCell.get(cell);
        if (!cellOutputs) {
            cellOutputs = new Set<TrackedDisplayOutput>();
            this.byCell.set(cell, cellOutputs);
        }
        cellOutputs.add(output);
        this.reconcileCurrent(output);
        return output;
    }

    public static getOutputTrackingId(output: NotebookCellOutput): string | undefined {
        return getOutputTrackingId(output);
    }

    /**
     * An unpublished output remains addressable, but only its submitting writer can safely edit its items.
     */
    public static getMappedOutput(
        notebook: NotebookDocument,
        displayId: string,
        flushDeferred = true
    ): TrackedDisplayOutput | undefined {
        const output = this.byNotebook.get(notebook)?.get(displayId);
        if (!output) {
            return;
        }
        const valid = flushDeferred ? this.flushDeferred(output) : this.reconcileCurrent(output);
        return valid ? output : undefined;
    }

    public static refreshOutput(output: TrackedDisplayOutput): void {
        this.flushDeferred(output);
    }

    public static getPendingOutputs(
        cell: NotebookCell,
        writer: NotebookCellExecution
    ): readonly TrackedDisplayOutput[] {
        this.reconcileCell(cell);
        const outputs = this.byCell.get(cell);
        return outputs ? [...outputs].filter((output) => !output.observed && output.pendingWriter === writer) : [];
    }

    public static deferUpdate(output: TrackedDisplayOutput, run: () => void, onDispose: () => void): boolean {
        this.clearDeferredUpdate(output);
        if (!this.isCurrent(output)) {
            return false;
        }
        output.deferredUpdate = { run, dispose: onDispose };
        return true;
    }

    public static clearDeferredUpdate(output: TrackedDisplayOutput): void {
        const deferred = output.deferredUpdate;
        output.deferredUpdate = undefined;
        deferred?.dispose();
    }

    public static retireOutput(output: TrackedDisplayOutput): void {
        this.clearDeferredUpdate(output);
        output.pendingWriter = undefined;
        const cellOutputs = this.byCell.get(output.cell);
        cellOutputs?.delete(output);
        if (cellOutputs?.size === 0) {
            this.byCell.delete(output.cell);
        }
        const map = this.byNotebook.get(output.cell.notebook);
        if (map?.get(output.displayId) === output) {
            map?.delete(output.displayId);
        }
    }

    private static retireNotebook(notebook: NotebookDocument): void {
        const outputs = this.byNotebook.get(notebook);
        if (outputs) {
            for (const output of outputs.values()) {
                this.retireOutput(output);
            }
            this.byNotebook.delete(notebook);
        }
    }

    private static retireCell(cell: NotebookCell): void {
        const outputs = this.byCell.get(cell);
        if (outputs) {
            for (const output of outputs) {
                this.retireOutput(output);
            }
        }
    }

    private static isCurrent(output: TrackedDisplayOutput): boolean {
        return this.byNotebook.get(output.cell.notebook)?.get(output.displayId) === output;
    }

    private static isCellUnavailable(cell: NotebookCell): boolean {
        return cell.document.isClosed || cell.notebook.isClosed || cell.index < 0;
    }

    private static observeSnapshot(cell: NotebookCell, snapshot: readonly NotebookCellOutput[]): void {
        // Deferred writes can synchronously change the model, so reconcile the cell before running them.
        for (const output of this.reconcileCell(cell, snapshot)) {
            this.flushDeferred(output);
        }
    }

    private static reconcileCell(cell: NotebookCell, snapshot?: readonly NotebookCellOutput[]): TrackedDisplayOutput[] {
        const outputs = this.byCell.get(cell);
        if (!outputs) {
            return [];
        }
        if (this.isCellUnavailable(cell)) {
            this.retireCell(cell);
            return [];
        }
        const tracked = [...outputs];
        const ids = new Set(tracked.map((output) => output.trackingId));
        const currentOutputs = cell.outputs;
        const current = indexTrackedOutputs(currentOutputs, ids);
        const reported = snapshot && snapshot !== currentOutputs ? indexTrackedOutputs(snapshot, ids) : current;
        const deferred: TrackedDisplayOutput[] = [];
        for (const output of tracked) {
            const match = current.get(output.trackingId);
            if (this.reconcile(output, match, reported.has(output.trackingId)) && match && output.deferredUpdate) {
                deferred.push(output);
            }
        }
        return deferred;
    }

    private static reconcileCurrent(output: TrackedDisplayOutput): boolean {
        if (!this.isCurrent(output) || this.isCellUnavailable(output.cell)) {
            this.retireOutput(output);
            return false;
        }
        const current = indexTrackedOutputs(output.cell.outputs, new Set([output.trackingId]));
        return this.reconcile(output, current.get(output.trackingId));
    }

    private static reconcile(
        output: TrackedDisplayOutput,
        current: NotebookCellOutput | null | undefined,
        reported = false
    ): boolean {
        if (!this.isCurrent(output) || this.isCellUnavailable(output.cell)) {
            this.retireOutput(output);
            return false;
        }
        // A snapshot is positive history; only the current outputs decide where to route.
        if (current !== undefined || reported) {
            output.observed = true;
            output.pendingWriter = undefined;
        }
        if (current === null) {
            return false;
        }
        if (current) {
            output.outputContainer = current;
            return true;
        }
        if (output.observed) {
            this.retireOutput(output);
            return false;
        }
        return true;
    }

    private static flushDeferred(output: TrackedDisplayOutput): boolean {
        if (!this.reconcileCurrent(output)) {
            return false;
        }
        const deferred = output.deferredUpdate;
        if (!deferred || !output.observed) {
            return true;
        }
        output.deferredUpdate = undefined;
        deferred.dispose();
        // Disposing a deferred update can synchronously replace its destination.
        if (!this.reconcileCurrent(output)) {
            return false;
        }
        if (output.observed) {
            deferred.run();
            return this.reconcileCurrent(output);
        }
        return true;
    }
}
