// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, extensions, Uri, workspace, window } from 'vscode';
import { INotebookEditorProvider } from '../../notebooks/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../platform/api/types';
import { PylanceExtension } from '../../platform/common/constants';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { traceInfo, traceWarning } from '../../platform/logging';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { isInteractiveInputTab } from '../../interactive-window/helpers';
import { isRemoteConnection } from '../../kernels/types';
import { noop } from '../../platform/common/utils/misc';

/**
 * Manages use of the Python extension's registerJupyterPythonPathFunction API which
 * enables us to provide the python.exe path for a notebook as required for Pylance's
 * LSP-based notebooks support.
 */
@injectable()
export class NotebookPythonPathService implements IExtensionSyncActivationService {
    private extensionChangeHandler: Disposable | undefined;

    private _isEnabled: boolean | undefined;

    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration
    ) {
        if (!this._isPylanceExtensionInstalled()) {
            this.extensionChangeHandler = extensions.onDidChange(this.extensionsChangeHandler.bind(this));
        }
    }

    public activate() {
        if (!this.isUsingPylance() || !this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }

        this.apiProvider
            .getApi()
            .then((api) => {
                if (api.registerJupyterPythonPathFunction !== undefined) {
                    api.registerJupyterPythonPathFunction((uri) => this._jupyterPythonPathFunction(uri));
                }
                if (api.registerGetNotebookUriForTextDocumentUriFunction !== undefined) {
                    api.registerGetNotebookUriForTextDocumentUriFunction((uri) =>
                        this._getNotebookUriForTextDocumentUri(uri)
                    );
                }
            })
            .catch(noop);
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
            return undefined;
        }

        const controller = this.controllerRegistration.getSelected(notebook);
        if (controller && isRemoteConnection(controller.connection)) {
            // Empty string is special, means do not use any interpreter at all.
            return '';
        }

        const interpreter = controller?.connection?.interpreter;

        if (!interpreter) {
            // Empty string is special, means do not use any interpreter at all.
            traceInfo(`No interpreter for Pylance for Notebook URI "${getDisplayPath(notebook.uri)}"`);
            return '';
        }
        return getFilePath(interpreter.uri);
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

    const notebookPath = `${textDocumentUri.path.replace('InteractiveInput-', 'Interactive-')}.interactive`;
    return workspace.notebookDocuments.find((doc) => doc.uri.path === notebookPath)?.uri;
}
