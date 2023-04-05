// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { inject, injectable } from 'inversify';
import { Disposable, extensions, Uri, workspace, window } from 'vscode';
import { INotebookEditorProvider } from '../../notebooks/types';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../platform/api/types';
import { PylanceExtension } from '../../platform/common/constants';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { traceInfo, traceVerbose } from '../../platform/logging';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { isInteractiveInputTab } from '../../interactive-window/helpers';

/**
 * Manages use of the Python extension's registerJupyterPythonPathFunction API which
 * enables us to provide the python.exe path for a notebook as required for Pylance's
 * LSP-based notebooks support.
 */
@injectable()
export class NotebookPythonPathService implements IExtensionSingleActivationService {
    private extensionChangeHandler: Disposable | undefined;

    private _isEnabled: boolean | undefined;

    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {
        if (!this._isPylanceExtensionInstalled()) {
            this.extensionChangeHandler = extensions.onDidChange(this.extensionsChangeHandler.bind(this));
        }
    }

    public async activate() {
        if (!this.isUsingPylance() || !this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }

        await this.apiProvider.getApi().then((api) => {
            if (api.registerJupyterPythonPathFunction !== undefined) {
                api.registerJupyterPythonPathFunction((uri) => this._jupyterPythonPathFunction(uri));
            }
            if (api.registerGetNotebookUriForTextDocumentUriFunction !== undefined) {
                api.registerGetNotebookUriForTextDocumentUriFunction((uri) =>
                    this._getNotebookUriForTextDocumentUri(uri)
                );
            }
        });
    }

    private async reset() {
        this._isEnabled = undefined;
        await this.activate();
    }

    private _isPylanceExtensionInstalled() {
        return extensions.getExtension(PylanceExtension) !== undefined;
    }

    private async extensionsChangeHandler(): Promise<void> {
        if (this._isPylanceExtensionInstalled() && this.extensionChangeHandler) {
            this.extensionChangeHandler.dispose();
            this.extensionChangeHandler = undefined;

            await this.reset();
        }
    }

    /**
     * Returns a boolean indicating whether Pylance's LSP notebooks experiment is enabled.
     * When this is True, the Python extension starts Pylance for notebooks instead of us.
     */
    public isUsingPylance() {
        if (this._isEnabled === undefined) {
            const pythonConfig = workspace.getConfiguration('python');
            const languageServer = pythonConfig?.get<string>('languageServer');

            // Only enable the experiment if we're in the treatment group and the installed
            // versions of Python and Pylance support the experiment.
            this._isEnabled = false;
            if (languageServer !== 'Pylance' && languageServer !== 'Default') {
                traceInfo(`Not using Pylance`);
            } else {
                this._isEnabled = true;
                traceInfo(`Using Pylance`);
            }
        }

        return this._isEnabled;
    }

    /**
     * Called by the Python extension to give Jupyter a chance to override the python.exe
     * path used by Pylance. Return undefined to allow Python to determine the path.
     */
    private async _jupyterPythonPathFunction(uri: Uri): Promise<string | undefined> {
        const notebook = this.notebookEditorProvider.findAssociatedNotebookDocument(uri);
        if (!notebook) {
            traceVerbose(`_jupyterPythonPathFunction: "${uri}" is not a notebook`);
            return undefined;
        }

        const controller = this.controllerRegistration.getSelected(notebook);
        const interpreter = controller
            ? controller.connection.interpreter
            : await this.interpreterService.getActiveInterpreter(uri);

        if (!interpreter) {
            traceVerbose(`_jupyterPythonPathFunction: Couldn't find interpreter for "${uri}"`);
            return undefined;
        }

        const pythonPath = getFilePath(interpreter.uri);

        traceVerbose(`_jupyterPythonPathFunction: Giving Pylance "${pythonPath}" as python path for "${uri}"`);

        return pythonPath;
    }

    private _getNotebookUriForTextDocumentUri(textDocumentUri: Uri): Uri | undefined {
        const notebookUri = getNotebookUriFromInputBoxUri(textDocumentUri);
        if (!notebookUri) {
            return undefined;
        }

        let result: string | undefined = undefined;
        window.tabGroups.all.find((group) => {
            group.tabs.find((tab) => {
                if (isInteractiveInputTab(tab)) {
                    const tabUri = tab.input.uri.toString();
                    // the interactive resource URI was altered to start with `/`, this will account for both URI formats
                    if (tab.input.uri.toString().endsWith(notebookUri.path)) {
                        result = tabUri;
                    }
                }
            });
        });
        return result;
    }
}

export function getNotebookUriFromInputBoxUri(textDocumentUri: Uri): Uri | undefined {
    if (textDocumentUri.scheme !== 'vscode-interactive-input') {
        return undefined;
    }

    // Temporarily remove fix to verify that tests fail on Linux
    const inputBoxPrefix = '\\InteractiveInput-';
    const notebookPath = `${textDocumentUri.fsPath.replace(inputBoxPrefix, 'Interactive-')}.interactive`;
    return textDocumentUri.with({ scheme: 'vscode-interactive', path: notebookPath });
}
