// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { isJupyterNotebook } from '../../platform/common/utils';
import { IInterpreterService } from '../../platform/interpreter/contracts';

/**
 * Ensures we refresh the list of Python environments upon opening a Notebook.
 */
@injectable()
export class InterpreterRefresher implements IExtensionSyncActivationService {
    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public activate() {
        this.disposables.push(this.vscNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebookEditor, this));
    }

    private onDidOpenNotebookEditor(e: NotebookDocument) {
        if (!isJupyterNotebook(e) || !this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }

        this.interpreterService.refreshInterpreters().ignoreErrors();
    }
}
