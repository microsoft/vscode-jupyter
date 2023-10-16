// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { INotebookLanguageClient } from './pylance';
import { cellIndexesToRanges, areRangesEqual, LocationWithReferenceKind, noop, Range } from './common';

const writeDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
        contentText: 'write',
        margin: '0 0 0 1em',
        backgroundColor: 'red'
    }
});

const readDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
        contentText: 'read',
        margin: '0 0 0 1em',
        backgroundColor: 'green'
    }
});

export interface IDocument {
    uri: vscode.Uri;
}

export interface INotebookCell {
    readonly document: IDocument;
}

export interface ILocationWithReferenceKind {
    uri: vscode.Uri;
    range: Range;
    kind?: string;
}

type ISymbol = vscode.SymbolInformation & vscode.DocumentSymbol;

export interface ILocationWithReferenceKindAndSymbol extends ILocationWithReferenceKind {
    associatedSymbol?: ISymbol;
}

/**
 * A defines symbol X
 * B modifies symbol X
 * C uses symbol X
 *
 * Fist step is the B and C uses symbol X so they depend on A, so to get the state of C, we need to run A -> output A and C
 * Second step is since B modifies symbol X, we need to run both A and B to get the state of C. -> output A, B and C
 */
export class CellAnalysis {
    constructor(
        private readonly _cellExecution: ICellExecution[],
        private readonly _cellRefs: Map<string, ILocationWithReferenceKindAndSymbol[]>
    ) {}

    /**
     * Get predecessor cells
     */
    getPredecessorCells(cell: INotebookCell): INotebookCell[] {
        // find last execution item index from this._cellExecution whose cell property matches cell
        var i;
        for (
            i = this._cellExecution.length - 1;
            i >= 0 && this._cellExecution[i].cell.document.uri.toString() !== cell.document.uri.toString();
            i--
        ) {
            // no-op
        }

        if (i === -1) {
            return [];
        }

        const lastExecutionIndex = i;
        const slicedCellExecution = this._cellExecution.slice(0, lastExecutionIndex + 1);
        const cellBitmap: boolean[] = new Array(slicedCellExecution.length).fill(false);
        cellBitmap[lastExecutionIndex] = true;

        const reversedCellRefs = new Map<string, string[]>(); // key: cell uri fragment, value: cell uri fragment[]
        for (const [key, dependents] of this._cellRefs.entries()) {
            const modifications = dependents.filter((item) => item.kind === 'write').map((item) => item.uri.fragment);
            dependents.forEach((dependent) => {
                const fragment = dependent.uri.fragment;

                if (reversedCellRefs.has(fragment)) {
                    reversedCellRefs.get(fragment)?.push(key);
                } else {
                    reversedCellRefs.set(fragment, [key]);
                }
            });

            // if a cell modifies a symbol, then all other cells that use the symbol (no matter read or write) will depend on this cell
            dependents.forEach((dependent) => {
                const fragment = dependent.uri.fragment;
                if (reversedCellRefs.has(fragment)) {
                    reversedCellRefs.get(fragment)?.push(...modifications);
                } else {
                    reversedCellRefs.set(fragment, modifications);
                }
            });
        }

        const cellFragment = cell.document.uri.fragment;
        this._resolveDependencies(
            reversedCellRefs,
            cellBitmap,
            cellFragment,
            slicedCellExecution.map((item) => item.cell)
        );

        const cellData: INotebookCell[] = [];
        for (let i = 0; i < cellBitmap.length; i++) {
            if (cellBitmap[i]) {
                cellData.push(slicedCellExecution[i].cell);
            }
        }

        return cellData;
    }

    /**
     * @todo
     * cell might not have symbols, but it can have references of other cells' symbols
     * if the reference to the symbol is a write operation, then the following cells that use the symbol will depend on this cell
     */
    getSuccessorCells(cell: INotebookCell): INotebookCell[] {
        const cellIndex = this._cellExecution.findIndex(
            (item) => item.cell.document.uri.fragment === cell.document.uri.fragment
        );
        if (cellIndex === -1) {
            return [];
        }

        const cellBitmap: boolean[] = new Array(this._cellExecution.length).fill(false);
        cellBitmap[cellIndex] = true;

        const modificationCellRefs: Map<string, ILocationWithReferenceKindAndSymbol[]> = new Map();
        this._cellRefs.forEach((refs) => {
            refs.forEach((ref) => {
                if (ref.kind === 'write') {
                    // this is a write ref, so all other read/write references to this symbol will depend on this cell
                    const modifiedCellFragment = ref.uri.fragment;
                    const modifiedCellRefs = modificationCellRefs.get(modifiedCellFragment) ?? [];
                    modifiedCellRefs.push(...refs.filter((item) => item !== ref));
                    modificationCellRefs.set(modifiedCellFragment, modifiedCellRefs);
                }
            });
        });

        // a symbol is a definition so modifying it is always a `write` operation
        for (let i = cellIndex; i < this._cellExecution.length; i++) {
            if (cellBitmap[i]) {
                const deps = this._cellRefs.get(this._cellExecution[i].cell.document.uri.fragment) || [];
                const modificationDeps =
                    modificationCellRefs.get(this._cellExecution[i].cell.document.uri.fragment) || [];
                const mergedDeps = [...deps, ...modificationDeps];

                mergedDeps.forEach((dep) => {
                    const index = this._cellExecution.findIndex(
                        (item) => item.cell.document.uri.fragment === dep.uri.fragment
                    );
                    // @todo what if index < cellIndex?
                    if (index !== -1 && index >= i) {
                        cellBitmap[index] = true;
                    }
                });
            }
        }

        const cellData: INotebookCell[] = [];
        for (let i = 0; i < cellBitmap.length; i++) {
            if (cellBitmap[i]) {
                cellData.push(this._cellExecution[i].cell);
            }
        }

        return cellData;
    }

    private _resolveDependencies(
        reversedCellRefs: Map<string, string[]>,
        cellBitmap: boolean[],
        cellFragment: string,
        cellExecution: INotebookCell[]
    ) {
        if (reversedCellRefs.has(cellFragment)) {
            for (const dependency of reversedCellRefs.get(cellFragment)!) {
                const index = cellExecution.findIndex((cell) => cell.document.uri.fragment === dependency);

                if (index === -1) {
                    throw new Error(`Dependency ${dependency} is not in the execution list.`);
                }
                if (!cellBitmap[index]) {
                    cellBitmap[index] = true;
                    this._resolveDependencies(reversedCellRefs, cellBitmap, dependency, cellExecution);
                }
            }
        }
    }
}

export interface ICellExecution {
    cell: INotebookCell;
    executionCount: number;
}

export class NotebookDocumentSymbolTracker {
    private _pendingRequests: Map<string, vscode.CancellationTokenSource> = new Map();
    private _cellRefs: Map<string, ILocationWithReferenceKindAndSymbol[]> = new Map();
    private _cellExecution: ICellExecution[] = [];
    private _disposables: vscode.Disposable[] = [];
    constructor(
        private readonly _notebookEditor: vscode.NotebookEditor,
        private readonly _client: INotebookLanguageClient
    ) {
        this._notebookEditor.notebook.getCells().forEach((cell) => {
            this._requestCellSymbols(cell, false).then(noop, noop);
        });

        this._disposables.push(
            vscode.workspace.onDidChangeNotebookDocument((e) => {
                if (e.notebook === this._notebookEditor.notebook) {
                    e.contentChanges.forEach((change) => {
                        change.removedCells.forEach((cell) => {
                            this._pendingRequests.delete(cell.document.uri.fragment);
                            this._cellRefs.delete(cell.document.uri.fragment);
                        });

                        change.addedCells.forEach((cell) => {
                            this._requestCellSymbols(cell, false).then(noop, noop);
                        });
                    });

                    e.cellChanges.forEach((change) => {
                        this._requestCellSymbols(change.cell, false).then(noop, noop);
                    });
                }
            })
        );

        this._disposables.push(
            vscode.notebooks.onDidChangeNotebookCellExecutionState((e) => {
                if (e.state === vscode.NotebookCellExecutionState.Idle && e.cell.document.languageId === 'python') {
                    // just finished execution
                    this._cellExecution.push({
                        cell: e.cell,
                        executionCount: e.cell.executionSummary?.executionOrder ?? 0
                    });
                }
            })
        );
    }

    async requestCellSymbolsSync() {
        const _pendingRequestsKeys = [...this._pendingRequests.keys()];
        this._pendingRequests.forEach((r) => r.cancel());
        this._pendingRequests.clear();
        // force request cell symbols synchronously
        for (const key of _pendingRequestsKeys) {
            const cell = this._notebookEditor.notebook.getCells().find((cell) => cell.document.uri.fragment === key);
            if (cell) {
                await this._requestCellSymbols(cell, true);
            }
        }
    }

    async gather(cell: vscode.NotebookCell) {
        await this.requestCellSymbolsSync();
        const analysis = new CellAnalysis(this._cellExecution, this._cellRefs);
        return analysis.getPredecessorCells(cell);
    }

    async selectSuccessorCells(cell: vscode.NotebookCell) {
        await this.requestCellSymbolsSync();
        const analysis = new CellAnalysis(this._cellExecution, this._cellRefs);
        const successorCells = analysis.getSuccessorCells(cell) as vscode.NotebookCell[];
        const cellRanges = cellIndexesToRanges(successorCells.map((cell) => cell.index));
        this._notebookEditor.selections = cellRanges;
    }

    async runSuccessorCells(cell: vscode.NotebookCell) {
        await this.requestCellSymbolsSync();
        const analysis = new CellAnalysis(this._cellExecution, this._cellRefs);
        const successorCells = analysis.getSuccessorCells(cell) as vscode.NotebookCell[];
        const cellRanges = cellIndexesToRanges(successorCells.map((cell) => cell.index));
        await vscode.commands
            .executeCommand('notebook.cell.execute', {
                ranges: cellRanges.map((range) => ({ start: range.start, end: range.end })),
                document: this._notebookEditor.notebook.uri
            })
            .then(noop, noop);
    }

    async debugSymbols() {
        const locations: ILocationWithReferenceKind[] = [];
        await this.requestCellSymbolsSync();

        console.log(JSON.stringify(Array.from(this._cellRefs.entries())));

        for (const editor of vscode.window.visibleTextEditors) {
            const document = editor.document;
            if (
                document.uri.scheme === 'vscode-notebook-cell' &&
                document.uri.path === this._notebookEditor.notebook.uri.path
            ) {
                const refs = this._cellRefs.get(document.uri.fragment);
                if (refs) {
                    locations.push(...refs);
                }
            }
        }

        // group locations by uri
        const locationsByUriFragment = new Map<string, ILocationWithReferenceKind[]>();
        locations.forEach((loc) => {
            const fragment = loc.uri.fragment;
            if (!locationsByUriFragment.has(fragment)) {
                locationsByUriFragment.set(fragment, []);
            }
            locationsByUriFragment.get(fragment)?.push(loc);
        });

        locationsByUriFragment.forEach((locations, fragment) => {
            const matcheEditor = vscode.window.visibleTextEditors.find(
                (editor) =>
                    editor.document.uri.path === this._notebookEditor.notebook.uri.path &&
                    editor.document.uri.fragment === fragment
            );
            if (matcheEditor) {
                const writeRanges: vscode.Range[] = [];
                const readRanges: vscode.Range[] = [];

                const dedupedLocations = locations.reduce(
                    (acc: ILocationWithReferenceKind[], current: ILocationWithReferenceKind) => {
                        const isDuplicate = acc.find((item) => areRangesEqual(item.range, current.range));
                        if (!isDuplicate) {
                            return acc.concat([current]);
                        } else {
                            return acc;
                        }
                    },
                    []
                );

                dedupedLocations.forEach((loc) => {
                    const position = new vscode.Position(loc.range.end.line, loc.range.end.character);
                    const range = new vscode.Range(position, position);

                    if (loc.kind === 'write') {
                        writeRanges.push(range);
                    } else if (loc.kind === 'read') {
                        readRanges.push(range);
                    }
                });

                matcheEditor.setDecorations(writeDecorationType, writeRanges);
                matcheEditor.setDecorations(readDecorationType, readRanges);
            }
        });
    }

    private async _requestCellSymbols(cell: vscode.NotebookCell, synchronous: boolean) {
        // request cell symbols in a debounced fashion
        const existing = this._pendingRequests.get(cell.document.uri.fragment);
        if (existing) {
            existing.cancel();
        }

        if (synchronous) {
            const cancellationTokenSource = new vscode.CancellationTokenSource();
            await this._doRequestCellSymbols(cell, cancellationTokenSource.token);
            cancellationTokenSource.dispose();
            return;
        }

        const request = new vscode.CancellationTokenSource();
        this._pendingRequests.set(cell.document.uri.fragment, request);

        // set timeout for 500ms, after which we will send the request
        setTimeout(() => {
            if (this._pendingRequests.get(cell.document.uri.fragment) !== request) {
                return;
            }

            this._pendingRequests.delete(cell.document.uri.fragment);
            if (request.token.isCancellationRequested) {
                return;
            }

            this._doRequestCellSymbols(cell, request.token).then(noop, noop);
        }, 500);
    }

    private async _getDocumentSymbols(cell: vscode.NotebookCell) {
        return vscode.commands.executeCommand<(vscode.SymbolInformation & vscode.DocumentSymbol)[] | undefined>(
            'vscode.executeDocumentSymbolProvider',
            cell.document.uri
        );
    }

    private async _doRequestCellSymbols(cell: vscode.NotebookCell, token: vscode.CancellationToken) {
        const symbols = await this._getDocumentSymbols(cell);
        if (!symbols) {
            return;
        }

        const references: (LocationWithReferenceKind & { associatedSymbol: ISymbol })[] = [];
        for (const symbol of symbols) {
            const symbolReferences = await this._client.getReferences(
                cell.document,
                symbol.selectionRange.start,
                { includeDeclaration: true },
                token
            );
            if (symbolReferences) {
                references.push(
                    ...symbolReferences.map((ref) => ({
                        ...ref,
                        associatedSymbol: symbol
                    }))
                );
            }
        }

        if (references.length) {
            // save refs for the cell
            this._cellRefs.set(
                cell.document.uri.fragment,
                references.map((ref) => ({
                    range: ref.range,
                    uri: vscode.Uri.parse(ref.uri),
                    kind: areRangesEqual(ref.range, ref.associatedSymbol.selectionRange) ? 'write' : ref.kind,
                    associatedSymbol: ref.associatedSymbol
                }))
            );
        }
    }

    dispose() {
        // clear all pending requests
        this._pendingRequests.forEach((r) => r.cancel());
        this._pendingRequests.clear();
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
    }
}

export class SymbolsTracker {
    private _disposables: vscode.Disposable[] = [];
    private _notebookDocumentSymbolTrackers: Map<string, NotebookDocumentSymbolTracker> = new Map();
    constructor(private readonly _client: INotebookLanguageClient) {
        vscode.window.visibleNotebookEditors.forEach((editor) => {
            this._notebookDocumentSymbolTrackers.set(
                editor.notebook.uri.toString(),
                new NotebookDocumentSymbolTracker(editor, this._client)
            );
        });

        this._disposables.push(
            vscode.window.onDidChangeVisibleNotebookEditors((e) => {
                e.forEach((editor) => {
                    if (!this._notebookDocumentSymbolTrackers.has(editor.notebook.uri.toString())) {
                        this._notebookDocumentSymbolTrackers.set(
                            editor.notebook.uri.toString(),
                            new NotebookDocumentSymbolTracker(editor, this._client)
                        );
                    }
                });

                // remove trackers for closed editors
                this._notebookDocumentSymbolTrackers.forEach((tracker, uri) => {
                    if (
                        !vscode.window.visibleNotebookEditors.find((editor) => editor.notebook.uri.toString() === uri)
                    ) {
                        tracker.dispose();
                        this._notebookDocumentSymbolTrackers.delete(uri);
                    }
                });
            })
        );
    }

    async debugSymbols(notebookDocument: vscode.NotebookDocument) {
        const tracker = this._notebookDocumentSymbolTrackers.get(notebookDocument.uri.toString());
        if (tracker) {
            await tracker.debugSymbols();
        }
    }

    async runSuccessorCells(notebookDocument: vscode.NotebookDocument, cell: vscode.NotebookCell) {
        const tracker = this._notebookDocumentSymbolTrackers.get(notebookDocument.uri.toString());
        if (tracker) {
            await tracker.runSuccessorCells(cell);
        }
    }

    async selectSuccessorCells(notebookDocument: vscode.NotebookDocument, cell: vscode.NotebookCell) {
        const tracker = this._notebookDocumentSymbolTrackers.get(notebookDocument.uri.toString());
        if (tracker) {
            await tracker.selectSuccessorCells(cell);
        }
    }

    async gatherCells(notebookDocument: vscode.NotebookDocument, cell: vscode.NotebookCell) {
        const tracker = this._notebookDocumentSymbolTrackers.get(notebookDocument.uri.toString());
        if (tracker) {
            return await tracker.gather(cell);
        }
    }

    dispose() {
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
    }
}
