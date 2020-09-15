// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Memento, Uri } from 'vscode';
import { PYTHON_LANGUAGE } from '../common/constants';
import { IDisposableRegistry, IMemento, WORKSPACE_MEMENTO } from '../common/types';
import { getKernelConnectionLanguage } from './jupyter/kernels/helpers';
import {
    IInteractiveWindowProvider,
    INotebook,
    INotebookAndInteractiveWindowUsageTracker,
    INotebookEditorProvider,
    INotebookProvider
} from './types';

const LastNotebookOpenedTimeKey = 'last-notebook-start-time';
const LastInteractiveWindowStartTimeKey = 'last-interactive-window-start-time';
const LastPythonNotebookCreatedKey = 'last-python-notebook-created';

@injectable()
export class NotebookAndInteractiveWindowUsageTracker implements INotebookAndInteractiveWindowUsageTracker {
    public get lastNotebookOpened() {
        const time = this.mementoStorage.get<number | undefined>(LastNotebookOpenedTimeKey);
        return time ? new Date(time) : undefined;
    }
    public get lastInteractiveWindowOpened() {
        const time = this.mementoStorage.get<number | undefined>(LastInteractiveWindowStartTimeKey);
        return time ? new Date(time) : undefined;
    }
    public get lastPythonNotebookCreated() {
        const time = this.mementoStorage.get<number | undefined>(LastPythonNotebookCreatedKey);
        return time ? new Date(time) : undefined;
    }
    constructor(
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private mementoStorage: Memento,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public async startTracking(): Promise<void> {
        this.disposables.push(
            this.notebookEditorProvider.onDidOpenNotebookEditor(() =>
                this.mementoStorage.update(LastNotebookOpenedTimeKey, Date.now())
            )
        );
        this.disposables.push(
            this.interactiveWindowProvider.onDidChangeActiveInteractiveWindow(() =>
                this.mementoStorage.update(LastInteractiveWindowStartTimeKey, Date.now())
            )
        );

        this.disposables.push(this.notebookProvider.onNotebookCreated(this.notebookCreated));
    }

    // Callback for when a notebook is created by the notebook provider
    // If it's a python notebook, then note the time for it
    private notebookCreated(evt: { identity: Uri; notebook: INotebook }) {
        const language = getKernelConnectionLanguage(evt.notebook.getKernelConnection());

        if (language === PYTHON_LANGUAGE) {
            this.mementoStorage.update(LastPythonNotebookCreatedKey, Date.now());
        }
    }
}
