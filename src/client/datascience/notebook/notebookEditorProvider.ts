// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri, NotebookDocument, NotebookEditor as VSCodeNotebookEditor } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import '../../common/extensions';
import { IFileSystem } from '../../common/platform/types';

import { IConfigurationService, IDisposableRegistry } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import { noop } from '../../common/utils/misc';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry } from '../../telemetry';
import { Commands, Telemetry } from '../constants';
import { IKernelProvider } from '../jupyter/kernels/types';
import { INotebookStorageProvider } from '../notebookStorage/notebookStorageProvider';
import { VSCodeNotebookModel } from '../notebookStorage/vscNotebookModel';
import { INotebookEditor, INotebookEditorProvider, INotebookProvider, IStatusProvider } from '../types';
import { JupyterNotebookView } from './constants';
import { NotebookCellLanguageService } from './defaultCellLanguageService';
import { isJupyterNotebook } from './helpers/helpers';
import { NotebookEditor } from './notebookEditor';

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
        @inject(INotebookStorageProvider) private readonly storage: INotebookStorageProvider,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IStatusProvider) private readonly statusProvider: IStatusProvider,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(NotebookCellLanguageService) private readonly cellLanguageService: NotebookCellLanguageService
    ) {
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
        const model = await this.storage.createNew(options, true);
        return this.open(model.file);
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
        const model = await this.storage.getOrCreateModel({ file: uri, isNative: true });
        if (model instanceof VSCodeNotebookModel) {
            model.associateNotebookDocument(doc);
        }
        // In open method we might be waiting.
        let editor = this.notebookEditorsByUri.get(uri.toString());
        if (!editor) {
            const notebookProvider = this.serviceContainer.get<INotebookProvider>(INotebookProvider);
            const kernelProvider = this.serviceContainer.get<IKernelProvider>(IKernelProvider);
            editor = new NotebookEditor(
                model,
                doc,
                this.vscodeNotebook,
                this.commandManager,
                notebookProvider,
                kernelProvider,
                this.statusProvider,
                this.appShell,
                this.configurationService,
                this.disposables,
                this.cellLanguageService
            );
            this.onEditorOpened(editor);
        }
        if (!this.notebooksWaitingToBeOpenedByUri.get(uri.toString())) {
            this.notebooksWaitingToBeOpenedByUri.set(uri.toString(), createDeferred<INotebookEditor>());
        }
        const deferred = this.notebooksWaitingToBeOpenedByUri.get(uri.toString())!;
        deferred.resolve(editor);
        this.notebookEditorsByUri.set(uri.toString(), editor);
        if (!model.isTrusted) {
            await this.commandManager.executeCommand(Commands.TrustNotebook, model.file);
        }
    }
    private onDidChangeActiveVsCodeNotebookEditor(editor: VSCodeNotebookEditor | undefined) {
        if (!editor) {
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
            if (editor.model) {
                editor.model.dispose();
            }
        }
        const model = this.storage.get(uri);
        if (model) {
            model.dispose();
        }
        this.notebookEditorsByUri.delete(uri.toString());
        this.notebooksWaitingToBeOpenedByUri.delete(uri.toString());
    }
}
