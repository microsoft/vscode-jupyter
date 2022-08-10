// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Memento, Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';

const key = 'INTERPRETER_PATH_SELECTED_FOR_JUPYTER_SERVER';
const keySelected = 'INTERPRETER_PATH_WAS_SELECTED_FOR_JUPYTER_SERVER';
/**
 * Keeps track of whether the user ever selected an interpreter to be used as the global jupyter interpreter.
 * Keeps track of the interpreter path of the interpreter used as the global jupyter interpreter.
 *
 * @export
 * @class JupyterInterpreterStateStore
 */
@injectable()
export class JupyterInterpreterStateStore {
    private _interpreterPath?: Uri;
    constructor(@inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento) {}

    /**
     * Whether the user set an interpreter at least once (an interpreter for starting of jupyter).
     *
     * @readonly
     * @type {Promise<boolean>}
     */
    public get interpreterSetAtleastOnce(): boolean {
        return !!this.selectedPythonPath || this.memento.get<boolean>(keySelected, false);
    }
    public get selectedPythonPath(): Uri | undefined {
        if (this._interpreterPath) {
            return this._interpreterPath;
        }
        const memento = this.memento.get<string | undefined>(key, undefined);
        if (memento) {
            return Uri.parse(memento);
        }
    }
    public updateSelectedPythonPath(value: Uri | undefined) {
        this._interpreterPath = value;
        this.memento.update(key, value?.toString()).then(noop, noop);
        this.memento.update(keySelected, true).then(noop, noop);
    }
}

@injectable()
export class MigrateJupyterInterpreterStateService implements IExtensionSingleActivationService {
    private settingsMigrated?: boolean;
    constructor(
        @inject(IPythonApiProvider) private readonly api: IPythonApiProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IPythonExtensionChecker) private readonly checker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}

    // Migrate the interpreter path selected for Jupyter server from the Python extension's globalState memento
    public async activate() {
        this.activateBackground().catch(noop);
        this.api.onDidActivatePythonExtension(this.activateBackground, this, this.disposables);
    }
    public async activateBackground() {
        // Migrate in the background.
        // Python extension will not activate unless Jupyter activates, and here we're waiting for Python.
        // Hence end in deadlock (caught in smoke test).
        if (!this.memento.get(key) && this.checker.isPythonExtensionActive) {
            await this.migrateSettings();
        }
    }
    private async migrateSettings() {
        if (this.settingsMigrated) {
            return;
        }
        this.settingsMigrated = true;
        const api = await this.api.getApi();
        const data = api.getInterpreterPathSelectedForJupyterServer();
        await this.memento.update(key, data);
        await this.memento.update(keySelected, true);
    }
}
