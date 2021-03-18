// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IInterpreterStatusbarVisibilityFilter, IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { IDisposableRegistry } from '../../common/types';
import { isJupyterNotebook } from '../../datascience/notebook/helpers/helpers';

@injectable()
export class InterpreterStatusBarVisibility
    implements IInterpreterStatusbarVisibilityFilter, IExtensionSingleActivationService {
    private _changed = new EventEmitter<void>();
    private _registered = false;

    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IPythonApiProvider) private pythonApi: IPythonApiProvider
    ) {
        vscNotebook.onDidChangeActiveNotebookEditor(
            () => {
                this._changed.fire();
            },
            this,
            disposables
        );
    }
    public async activate(): Promise<void> {
        // Tell the python extension about our filter
        if (this.extensionChecker.isPythonExtensionActive) {
            this.registerStatusFilter();
        } else {
            this.pythonApi.onDidActivePythonExtension(this.registerStatusFilter, this, this.disposables);
        }
    }
    public get changed(): Event<void> {
        return this._changed.event;
    }
    public get hidden() {
        return this.vscNotebook.activeNotebookEditor &&
            isJupyterNotebook(this.vscNotebook.activeNotebookEditor.document)
            ? true
            : false;
    }
    private registerStatusFilter() {
        if (this._registered) {
            return;
        }
        this._registered = true;
        this.pythonApi
            .getApi()
            .then((a) => {
                // Python API may not have the register function yet.
                if (a.registerInterpreterStatusFilter) {
                    a.registerInterpreterStatusFilter(this);
                }
            })
            .ignoreErrors();
    }
}
