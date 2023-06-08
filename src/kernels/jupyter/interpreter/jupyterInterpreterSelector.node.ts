// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { QuickPickOptions } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths.node';
import { DataScience } from '../../../platform/common/utils/localize';
import { IInterpreterSelector } from '../../../platform/interpreter/configuration/types';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { JupyterInterpreterStateStore } from './jupyterInterpreterStateStore.node';

/**
 * Displays interpreter select and returns the selection to the user.
 *
 * @export
 * @class JupyterInterpreterSelector
 */
@injectable()
export class JupyterInterpreterSelector {
    constructor(
        @inject(IInterpreterSelector) private readonly interpreterSelector: IInterpreterSelector,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(JupyterInterpreterStateStore) private readonly interpreterSelectionState: JupyterInterpreterStateStore,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}
    /**
     * Displays interpreter selector and returns the selection.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<PythonEnvironment | undefined>)}
     * @memberof JupyterInterpreterSelector
     */
    public async selectInterpreter(token?: CancellationToken): Promise<PythonEnvironment | undefined> {
        const currentPythonPath = this.interpreterSelectionState.selectedPythonPath
            ? getDisplayPath(this.interpreterSelectionState.selectedPythonPath, this.workspace.workspaceFolders || [])
            : undefined;

        const suggestions = await this.interpreterSelector.getSuggestions(undefined);
        if (token?.isCancellationRequested) {
            return;
        }
        const quickPickOptions: QuickPickOptions = {
            matchOnDetail: true,
            matchOnDescription: true,
            placeHolder: currentPythonPath
                ? DataScience.currentlySelectedJupyterInterpreterForPlaceholder(currentPythonPath)
                : ''
        };

        const selection = await this.applicationShell.showQuickPick(suggestions, quickPickOptions);
        if (!selection) {
            return;
        }
        return selection.interpreter;
    }
}
