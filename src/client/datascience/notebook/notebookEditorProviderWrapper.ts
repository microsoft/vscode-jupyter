// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
import '../../common/extensions';
import { IDisposableRegistry } from '../../common/types';
import { VSCodeNotebookProvider } from '../constants';
import { INotebookEditor, INotebookEditorProvider } from '../types';

/**
 * Notebook Editor provider used by other parts of DS code.
 * This is an adapter, that takes the VSCode api for editors (did notebook editors open, close save, etc) and
 * then exposes them in a manner we expect - i.e. INotebookEditorProvider.
 * This is also responsible for tracking all notebooks that open and then keeping the VS Code notebook models updated with changes we made to our underlying model.
 * E.g. when cells are executed the results in our model is updated, this tracks those changes and syncs VSC cells with those updates.
 */
@injectable()
export class NotebookEditorProviderWrapper implements INotebookEditorProvider {
    public get onDidChangeActiveNotebookEditor(): Event<INotebookEditor | undefined> {
        return this.vscodeNotebookEditorProvider.onDidChangeActiveNotebookEditor;
    }
    public get onDidCloseNotebookEditor(): Event<INotebookEditor> {
        return this.vscodeNotebookEditorProvider.onDidCloseNotebookEditor;
    }
    public get onDidOpenNotebookEditor(): Event<INotebookEditor> {
        return this._onDidOpenNotebookEditor.event;
    }
    public get activeEditor(): INotebookEditor | undefined {
        return this.vscodeNotebookEditorProvider?.activeEditor;
    }
    public get editors(): INotebookEditor[] {
        // If a VS Code notebook is opened, then user vscode notebooks provider.
        if (this.vscodeNotebookEditorProvider.activeEditor) {
            return this.vscodeNotebookEditorProvider.editors;
        }
        return this.vscodeNotebookEditorProvider.editors;
    }
    protected readonly _onDidChangeActiveNotebookEditor = new EventEmitter<INotebookEditor | undefined>();
    protected readonly _onDidOpenNotebookEditor = new EventEmitter<INotebookEditor>();
    private readonly _onDidCloseNotebookEditor = new EventEmitter<INotebookEditor>();
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(VSCodeNotebookProvider) private readonly vscodeNotebookEditorProvider: INotebookEditorProvider
    ) {
        // Even if user doesn't belong to notebook experiment, they can open a notebook using the new vsc Notebook ui.
        this.vscodeNotebookEditorProvider.onDidChangeActiveNotebookEditor(
            (e) => {
                this._onDidChangeActiveNotebookEditor.fire(e);
            },
            this,
            this.disposables
        );
        // This can be done blindly, as th VSCodeNotebook API would trigger these events only if it was explicitly used.
        this.vscodeNotebookEditorProvider.onDidCloseNotebookEditor(
            this._onDidCloseNotebookEditor.fire,
            this._onDidCloseNotebookEditor,
            this.disposables
        );
        // This can be done blindly, as th VSCodeNotebook API would trigger these events only if it was explicitly used.
        this.vscodeNotebookEditorProvider.onDidOpenNotebookEditor(
            this._onDidOpenNotebookEditor.fire,
            this._onDidOpenNotebookEditor,
            this.disposables
        );
    }

    public async open(file: Uri): Promise<INotebookEditor> {
        return this.vscodeNotebookEditorProvider.open(file);
    }
    public async show(file: Uri): Promise<INotebookEditor | undefined> {
        return this.vscodeNotebookEditorProvider.show(file);
    }
    public async createNew(options?: { contents?: string; defaultCellLanguage: string }): Promise<INotebookEditor> {
        return this.vscodeNotebookEditorProvider.createNew(options);
    }
}
