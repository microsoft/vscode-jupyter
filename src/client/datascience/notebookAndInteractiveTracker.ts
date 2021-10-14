// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { PYTHON_LANGUAGE } from '../common/constants';
import { IDisposableRegistry, IMemento, WORKSPACE_MEMENTO } from '../common/types';
import { getKernelConnectionLanguage } from './jupyter/kernels/helpers';
import { IKernel, IKernelProvider } from './jupyter/kernels/types';
import { INotebookCreationTracker } from './types';

const LastPythonNotebookCreatedKey = 'last-python-notebook-created';
const LastNotebookCreatedKey = 'last-notebook-created';

@injectable()
export class NotebookCreationTracker implements INotebookCreationTracker {
    public get lastPythonNotebookCreated() {
        const time = this.mementoStorage.get<number | undefined>(LastPythonNotebookCreatedKey);
        return time ? new Date(time) : undefined;
    }
    public get lastNotebookCreated() {
        const time = this.mementoStorage.get<number | undefined>(LastNotebookCreatedKey);
        return time ? new Date(time) : undefined;
    }
    constructor(
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private mementoStorage: Memento,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public async startTracking(): Promise<void> {
        this.disposables.push(this.kernelProvider.onDidStartKernel(this.kernelStarted, this));
    }

    // Callback for when a notebook is created by the notebook provider
    // Note the time as well as an extra time for python specific notebooks
    private kernelStarted(kernel: IKernel) {
        const language = getKernelConnectionLanguage(kernel.kernelConnectionMetadata);

        void this.mementoStorage.update(LastNotebookCreatedKey, Date.now());

        if (language === PYTHON_LANGUAGE) {
            void this.mementoStorage.update(LastPythonNotebookCreatedKey, Date.now());
        }
    }
}
