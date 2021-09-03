// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    Event,
    EventEmitter,
    Uri,
    NotebookDocument,
    NotebookEditor as VSCodeNotebookEditor,
    NotebookData,
    NotebookCellData,
    NotebookCellKind
} from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import '../../common/extensions';
import { IFileSystem } from '../../common/platform/types';

import { IDisposableRegistry, IExtensions } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import { noop } from '../../common/utils/misc';
import { captureTelemetry } from '../../telemetry';
import { Commands, defaultNotebookFormat, Telemetry } from '../constants';
import { INotebookEditor, INotebookEditorProvider } from '../types';
import { JupyterNotebookView } from './constants';
import { NotebookCellLanguageService } from './cellLanguageService';
import { isJupyterNotebook } from './helpers/helpers';
import { NotebookEditor } from './notebookEditor';
import { PYTHON_LANGUAGE } from '../../common/constants';

/**
 * Notebook Editor provider used by other parts of DS code.
 * This is an adapter, that takes the VSCode api for editors (did notebook editors open, close save, etc) and
 * then exposes them in a manner we expect - i.e. INotebookEditorProvider.
 * This is also responsible for tracking all notebooks that open and then keeping the VS Code notebook models updated with changes we made to our underlying model.
 * E.g. when cells are executed the results in our model is updated, this tracks those changes and syncs VSC cells with those updates.
 */
@injectable()
export class NotebookEditorProvider implements INotebookEditorProvider {
    public get onDidChangeActiveNotebookEditor(): Event<INotebookEditor | undefined> {
        return this._onDidChangeActiveNotebookEditor.event;
    }
    public get onDidCloseNotebookEditor(): Event<INotebookEditor> {
        return this._onDidCloseNotebookEditor.event;
    }
    public get onDidOpenNotebookEditor(): Event<INotebookEditor> {
        return this._onDidOpenNotebookEditor.event;
    }
    public get activeEditor(): INotebookEditor | undefined {
        // Ask VS code for which one is active. Don't use webview tracking as it seems to be inaccurate
        return (
            this.vscodeNotebook.activeNotebookEditor &&
            this.editors.find(
                (e) => e.file.toString() === this.vscodeNotebook.activeNotebookEditor?.document.uri.toString()
            )
        );
    }
    public get editors(): INotebookEditor[] {
        return [...this.openedEditors];
    }
    protected readonly _onDidChangeActiveNotebookEditor = new EventEmitter<INotebookEditor | undefined>();
    protected readonly _onDidOpenNotebookEditor = new EventEmitter<INotebookEditor>();
    private readonly _onDidCloseNotebookEditor = new EventEmitter<INotebookEditor>();
    private readonly openedEditors = new Set<INotebookEditor>();
    private readonly trackedVSCodeNotebookEditors = new Set<VSCodeNotebookEditor>();
    private readonly notebookEditorsByUri = new Map<string, INotebookEditor>();
    private readonly notebooksWaitingToBeOpenedByUri = new Map<string, Deferred<INotebookEditor>>();
    constructor(
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(NotebookCellLanguageService) private readonly cellLanguageService: NotebookCellLanguageService,
        @inject(IExtensions) private readonly extensions: IExtensions
    ) {
        disposables.push(this);
        // Register notebook documents that are already open e.g. after a workspace reload
        for (const notebookDocument of this.vscodeNotebook.notebookDocuments) {
            void this.onDidOpenNotebookDocument(notebookDocument);
        }
        this.disposables.push(this.vscodeNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this));
        this.disposables.push(this.vscodeNotebook.onDidCloseNotebookDocument(this.onDidCloseNotebookDocument, this));
        this.disposables.push(
            this.vscodeNotebook.onDidChangeActiveNotebookEditor(this.onDidChangeActiveVsCodeNotebookEditor, this)
        );
        this.disposables.push(
            this.commandManager.registerCommand(Commands.OpenNotebookInPreviewEditor, async (uri?: Uri) => {
                if (uri) {
                    captureTelemetry(Telemetry.OpenNotebook, { scope: 'command' }, false);
                    this.open(uri).ignoreErrors();
                }
            })
        );
    }
    public dispose() {
        const items = Array.from(this.openedEditors.keys());
        items.map((item) => {
            try {
                item.dispose();
            } catch (ex) {
                noop;
            }
        });
        this.openedEditors.clear();
    }

    public async open(file: Uri): Promise<INotebookEditor> {
        if (this.notebooksWaitingToBeOpenedByUri.get(file.toString())) {
            return this.notebooksWaitingToBeOpenedByUri.get(file.toString())!.promise;
        }

        // Wait for editor to get opened up, vscode will notify when it is opened.
        // Further below.
        this.notebooksWaitingToBeOpenedByUri.set(file.toString(), createDeferred<INotebookEditor>());
        const deferred = this.notebooksWaitingToBeOpenedByUri.get(file.toString())!;

        // Tell VSC to open the notebook, at which point it will fire a callback when a notebook document has been opened.
        // Then our promise will get resolved.
        await this.commandManager.executeCommand('vscode.openWith', file, JupyterNotebookView);

        // This gets resolved when we have handled the opening of the notebook.
        return deferred.promise;
    }
    public async show(_file: Uri): Promise<INotebookEditor | undefined> {
        // We do not need this.
        return;
    }
    @captureTelemetry(Telemetry.CreateNewNotebook, undefined, false)
    public async createNew(options?: { contents?: string; defaultCellLanguage: string }): Promise<INotebookEditor> {
        // contents will be ignored
        const language = options?.defaultCellLanguage ?? PYTHON_LANGUAGE;
        const cell = new NotebookCellData(NotebookCellKind.Code, '', language);
        const data = new NotebookData([cell]);
        data.metadata = {
            custom: {
                cells: [],
                metadata: {
                    orig_nbformat: defaultNotebookFormat.major
                },
                nbformat: defaultNotebookFormat.major,
                nbformat_minor: defaultNotebookFormat.minor
            }
        };
        const doc = await this.vscodeNotebook.openNotebookDocument(JupyterNotebookView, data);
        await this.vscodeNotebook.showNotebookDocument(doc);
        return this.open(doc.uri);
    }
    private onEditorOpened(editor: INotebookEditor): void {
        this.openedEditors.add(editor);
        editor.closed(this.closedEditor, this, this.disposables);
        this._onDidOpenNotebookEditor.fire(editor);
        this._onDidChangeActiveNotebookEditor.fire(editor);
    }

    private closedEditor(editor: INotebookEditor): void {
        if (this.openedEditors.has(editor)) {
            this.openedEditors.delete(editor);
            this._onDidCloseNotebookEditor.fire(editor);
            this._onDidChangeActiveNotebookEditor.fire(this.activeEditor);

            // Find all notebooks associated with this editor (ipynb file).
            const otherEditors = this.editors.filter(
                (e) => this.fs.areLocalPathsSame(e.file.fsPath, editor.file.fsPath) && e !== editor
            );

            // If we have no editors for this file, then dispose the notebook.
            if (otherEditors.length === 0) {
                editor.notebook?.dispose().catch(noop);
            }
        }
    }

    private async onDidOpenNotebookDocument(doc: NotebookDocument): Promise<void> {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        const uri = doc.uri;
        // In open method we might be waiting.
        let editor = this.notebookEditorsByUri.get(uri.toString());
        if (!editor) {
            editor = new NotebookEditor(
                doc,
                this.vscodeNotebook,
                this.commandManager,
                this.disposables,
                this.cellLanguageService,
                this.extensions
            );
            this.onEditorOpened(editor);
        }
        if (!this.notebooksWaitingToBeOpenedByUri.get(uri.toString())) {
            this.notebooksWaitingToBeOpenedByUri.set(uri.toString(), createDeferred<INotebookEditor>());
        }
        const deferred = this.notebooksWaitingToBeOpenedByUri.get(uri.toString())!;
        deferred.resolve(editor);
        this.notebookEditorsByUri.set(uri.toString(), editor);
    }
    private onDidChangeActiveVsCodeNotebookEditor(editor: VSCodeNotebookEditor | undefined) {
        if (!editor) {
            this._onDidChangeActiveNotebookEditor.fire(undefined);
            return;
        }
        if (!isJupyterNotebook(editor.document)) {
            this._onDidChangeActiveNotebookEditor.fire(undefined);
            return;
        }
        if (this.trackedVSCodeNotebookEditors.has(editor)) {
            const ourEditor = this.editors.find((item) => item.file.toString() === editor.document.uri.toString());
            this._onDidChangeActiveNotebookEditor.fire(ourEditor);
            return;
        }
        this.trackedVSCodeNotebookEditors.add(editor);
    }
    private async onDidCloseNotebookDocument(document: NotebookDocument) {
        this.disposeResourceRelatedToNotebookEditor(document.uri);
    }
    private disposeResourceRelatedToNotebookEditor(uri: Uri) {
        // Ok, dispose all of the resources associated with this document.
        // In our case, we only have one editor.
        const editor = this.notebookEditorsByUri.get(uri.toString());
        if (editor) {
            this.closedEditor(editor);
            editor.dispose();
        }
        this.notebookEditorsByUri.delete(uri.toString());
        this.notebooksWaitingToBeOpenedByUri.delete(uri.toString());
    }
}
