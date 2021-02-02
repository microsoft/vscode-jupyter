// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IInterpreterStatusbarVisibilityFilter, IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { IDisposableRegistry, IExtensions } from '../../common/types';
import { isJupyterNotebook } from '../../datascience/notebook/helpers/helpers';

@injectable()
export class InterpreterStatusBarVisibility
    implements IInterpreterStatusbarVisibilityFilter, IExtensionSingleActivationService {
    private _changed = new EventEmitter<void>();
    private _registered = false;

    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IPythonApiProvider) private pythonApi: IPythonApiProvider,
        @inject(IExtensions) readonly extensions: IExtensions
    ) {
        vscNotebook.onDidChangeActiveNotebookEditor(
            () => {
                this._changed.fire();
            },
            this,
            disposables
        );
        extensions.onDidChange(this.extensionsChanged, this, disposables);
    }
    public async activate(): Promise<void> {
        // Tell the python extension about our filter
        if (this.extensionChecker.isPythonExtensionInstalled) {
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
    public get changed(): Event<void> {
        return this._changed.event;
    }
    public get hidden() {
        return this.vscNotebook.activeNotebookEditor &&
            isJupyterNotebook(this.vscNotebook.activeNotebookEditor.document)
            ? true
            : false;
    }
    private extensionsChanged() {
        // See if the python extension was suddenly registered
        if (this.extensionChecker.isPythonExtensionInstalled && this._registered) {
            this.activate().ignoreErrors();
        }
    }
}
