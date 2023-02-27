// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import { IInterpreterStatusbarVisibilityFilter, IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { IDisposableRegistry } from '../../common/types';
import { isJupyterNotebook } from '../../common/utils';
import { noop } from '../../common/utils/misc';

/**
 * Singleton that listens to active editor changes in order to hide/show the python interpreter
 */
@injectable()
export class InterpreterStatusBarVisibility
    implements IInterpreterStatusbarVisibilityFilter, IExtensionSyncActivationService
{
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
    public activate() {
        // Tell the python extension about our filter
        if (this.extensionChecker.isPythonExtensionActive) {
            this.registerStatusFilter();
        } else {
            this.pythonApi.onDidActivatePythonExtension(this.registerStatusFilter, this, this.disposables);
        }
    }
    public get changed(): Event<void> {
        return this._changed.event;
    }
    public get hidden() {
        return this.vscNotebook.activeNotebookEditor &&
            isJupyterNotebook(this.vscNotebook.activeNotebookEditor.notebook)
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
                    // Get Python extension to check whether to show/hide after it activates.
                    this._changed.fire();
                }
            })
            .catch(noop);
    }
}
