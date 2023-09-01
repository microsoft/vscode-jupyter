// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import {
    CancellationToken,
    CodeAction,
    CodeActionContext,
    CodeActionKind,
    CodeActionProvider,
    DiagnosticSeverity,
    DiagnosticCollection,
    languages,
    NotebookCell,
    NotebookCellKind,
    NotebookDocument,
    Position,
    Range,
    Selection,
    TextDocument,
    Uri,
    WorkspaceEdit,
    Hover,
    HoverProvider,
    Diagnostic,
    workspace
} from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IVSCodeNotebook, IDocumentManager } from '../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { dispose } from '../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { JupyterNotebookView } from '../../platform/common/constants';
import { getAssociatedJupyterNotebook } from '../../platform/common/utils';

type CellUri = string;
type CellVersion = number;

const pipMessage = DataScience.percentPipCondaInstallInsteadOfBang('pip');
const condaMessage = DataScience.percentPipCondaInstallInsteadOfBang('conda');
const matplotlibMessage = DataScience.matplotlibWidgetInsteadOfOther;
const diagnosticSource = 'Jupyter';

/**
 * Provides a diagnostic error to explain that !pip and !conda should not be used, instead use %pip and %conda because they run the correct version of pip and conda.
 */
@injectable()
export class NotebookCellBangInstallDiagnosticsProvider
    implements IExtensionSyncActivationService, CodeActionProvider, HoverProvider
{
    public readonly problems: DiagnosticCollection;
    private readonly disposables: IDisposable[] = [];
    private readonly notebooksProcessed = new WeakMap<NotebookDocument, Map<CellUri, CellVersion>>();
    private readonly cellsToProcess = new Set<NotebookCell>();
    constructor(
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IDocumentManager) private readonly documents: IDocumentManager
    ) {
        this.problems = languages.createDiagnosticCollection(diagnosticSource);
        this.disposables.push(this.problems);
        disposables.push(this);
    }
    public dispose() {
        dispose(this.disposables);
        this.problems.dispose();
    }
    public activate(): void {
        this.disposables.push(languages.registerCodeActionsProvider(PYTHON_LANGUAGE, this));
        this.disposables.push(languages.registerHoverProvider(PYTHON_LANGUAGE, this));
        this.documents.onDidChangeTextDocument(
            (e) => {
                const notebook = getAssociatedJupyterNotebook(e.document);
                if (!notebook) {
                    return;
                }
                const cell = notebook.getCells().find((c) => c.document === e.document);
                if (cell) {
                    this.analyzeNotebookCell(cell);
                }
            },
            this,
            this.disposables
        );
        this.notebooks.onDidCloseNotebookDocument(
            (e) => {
                this.problems.delete(e.uri);
                const cells = this.notebooksProcessed.get(e);
                this.notebooksProcessed.delete(e);
                if (!cells) {
                    return;
                }
                cells.forEach((_, uri) => this.problems.delete(Uri.parse(uri)));
            },
            this,
            this.disposables
        );

        this.notebooks.onDidOpenNotebookDocument((e) => this.analyzeNotebook(e), this, this.disposables);
        workspace.onDidChangeNotebookDocument(
            (e) => {
                const cells = this.notebooksProcessed.get(e.notebook);
                e.contentChanges.forEach((change) => {
                    change.removedCells.forEach((cell) => {
                        cells?.delete(cell.document.uri.toString());
                    });
                    change.addedCells.forEach((cell) => this.queueCellForProcessing(cell));
                });
                e.cellChanges.forEach((change) => this.queueCellForProcessing(change.cell));
            },
            this,
            this.disposables
        );
        this.notebooks.notebookDocuments.map((e) => this.analyzeNotebook(e));
    }
    public provideHover(document: TextDocument, position: Position, _token: CancellationToken) {
        const notebook = getAssociatedJupyterNotebook(document);
        if (notebook?.notebookType !== JupyterNotebookView) {
            return;
        }
        const diagnostics = this.problems.get(document.uri);
        if (!diagnostics) {
            return;
        }
        const diagnostic = diagnostics.find((d) => d.message === pipMessage || d.message === condaMessage);
        if (!diagnostic || !diagnostic.range.contains(position)) {
            return;
        }
        const installer = diagnostic.message === pipMessage ? 'pip' : 'conda';
        return new Hover(
            DataScience.pipCondaInstallHoverWarning(installer, 'https://aka.ms/jupyterCellMagicBangInstall'),
            diagnostic.range
        );
    }

    public provideCodeActions(
        document: TextDocument,
        _range: Range | Selection,
        context: CodeActionContext,
        _token: CancellationToken
    ): CodeAction[] {
        if (!getAssociatedJupyterNotebook(document)) {
            return [];
        }
        const codeActions: CodeAction[] = [];
        context.diagnostics.forEach((d) => {
            switch (d.message) {
                case pipMessage:
                    codeActions.push(this.createReplaceCodeAction(document, 'pip', d));
                    break;
                case condaMessage:
                    codeActions.push(this.createReplaceCodeAction(document, 'conda', d));
                    break;

                case matplotlibMessage:
                    codeActions.push(
                        this.createGotoWikiAction(
                            document,
                            Uri.parse('https://aka.ms/vscodejupytermatplotlibwidget'),
                            d
                        )
                    );
                    break;

                default:
                    break;
            }
        });
        return codeActions;
    }
    private createReplaceCodeAction(document: TextDocument, type: 'pip' | 'conda', d: Diagnostic) {
        const codeAction = new CodeAction(DataScience.replacePipCondaInstallCodeAction(type), CodeActionKind.QuickFix);
        codeAction.isPreferred = true;
        codeAction.diagnostics = [d];
        const edit = new WorkspaceEdit();
        edit.replace(
            document.uri,
            new Range(d.range.start, new Position(d.range.start.line, d.range.start.character + 1)),
            '%'
        );
        codeAction.edit = edit;
        return codeAction;
    }
    private createGotoWikiAction(_document: TextDocument, uri: Uri, d: Diagnostic) {
        const codeAction = new CodeAction(DataScience.matplotlibWidgetCodeActionTitle, CodeActionKind.QuickFix);
        codeAction.isPreferred = true;
        codeAction.diagnostics = [d];
        codeAction.command = {
            title: DataScience.matplotlibWidgetCodeActionTitle,
            command: 'vscode.open',
            arguments: [uri]
        };
        return codeAction;
    }
    private analyzeNotebook(notebook: NotebookDocument): void {
        if (notebook.notebookType !== JupyterNotebookView) {
            return;
        }
        // Process just the first 100 cells to avoid blocking the UI.
        notebook.getCells().forEach((cell, i) => (i < 100 ? this.queueCellForProcessing(cell) : undefined));
    }

    private queueCellForProcessing(cell: NotebookCell): void {
        this.cellsToProcess.add(cell);
        this.analyzeNotebookCells();
    }
    private analyzeNotebookCells() {
        if (this.cellsToProcess.size === 0) {
            return;
        }
        const cell = this.cellsToProcess.values().next().value;
        this.cellsToProcess.delete(cell);
        this.analyzeNotebookCell(cell);
        // Schedule processing of next cell (this way we dont chew CPU and block the UI).
        setTimeout(() => this.analyzeNotebookCells(), 0);
    }
    private analyzeNotebookCell(cell: NotebookCell) {
        if (
            cell.kind !== NotebookCellKind.Code ||
            cell.document.languageId !== PYTHON_LANGUAGE ||
            cell.notebook.isClosed ||
            cell.document.isClosed
        ) {
            return;
        }
        // If we've already process this same cell, and the version is the same, then we don't need to do anything.
        if (this.notebooksProcessed.get(cell.notebook)?.get(cell.document.uri.toString()) === cell.document.version) {
            return;
        }

        this.problems.delete(cell.document.uri);
        const cellsUrisWithProblems = this.notebooksProcessed.get(cell.notebook) || new Map<CellUri, CellVersion>();
        cellsUrisWithProblems.set(cell.document.uri.toString(), cell.document.version);
        this.notebooksProcessed.set(cell.notebook, cellsUrisWithProblems);

        // For perf reasons, process just the first 50 lines.
        for (let i = 0; i < Math.min(cell.document.lineCount, 50); i++) {
            const line = cell.document.lineAt(i);
            const text = line.text;
            if (text.trim().startsWith('!pip install')) {
                const startPos = text.indexOf('!');
                const endPos = text.indexOf('l');
                const range = new Range(line.lineNumber, startPos, line.lineNumber, endPos + 2);
                this.problems.set(cell.document.uri, [
                    {
                        message: pipMessage,
                        range,
                        severity: DiagnosticSeverity.Error,
                        source: diagnosticSource
                    }
                ]);
            } else if (text.trim().startsWith('!conda install')) {
                const startPos = text.indexOf('!');
                const endPos = text.indexOf('l');
                const range = new Range(line.lineNumber, startPos, line.lineNumber, endPos + 2);
                this.problems.set(cell.document.uri, [
                    {
                        message: condaMessage,
                        range,
                        severity: DiagnosticSeverity.Error,
                        source: diagnosticSource
                    }
                ]);
            } else if (
                text.trim().startsWith('%matplotlib') &&
                !text.trim().endsWith('widget') &&
                !text.trim().endsWith('inline')
            ) {
                const startPos = text.indexOf('%');
                const endPos = text.length;
                const range = new Range(line.lineNumber, startPos, line.lineNumber, endPos);
                this.problems.set(cell.document.uri, [
                    {
                        message: matplotlibMessage,
                        range,
                        severity: DiagnosticSeverity.Warning,
                        source: diagnosticSource
                    }
                ]);
            }
        }
    }
}
