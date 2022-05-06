// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { Disposable, extensions, Uri } from 'vscode';
import { IInteractiveWindowProvider } from '../interactive-window/types';
import { findAssociatedNotebookDocument } from '../notebooks/helpers';
import { INotebookControllerManager } from '../notebooks/types';
import { IExtensionSingleActivationService } from '../platform/activation/types';
import { IPythonApiProvider } from '../platform/api/types';
import { IVSCodeNotebook } from '../platform/common/application/types';
import { PylanceExtension, PythonExtension } from '../platform/common/constants';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { IConfigurationService } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import * as semver from 'semver';
import { traceInfo, traceVerbose } from '../platform/logging';

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
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {
        if (!this._isPylanceExtensionInstalled()) {
            this.extensionChangeHandler = extensions.onDidChange(this.extensionsChangeHandler.bind(this));
        }
    }

    public async activate() {
        if (!this.isPylanceUsingLspNotebooks()) {
            return;
        }

        await this.apiProvider.getApi().then((api) => {
            if (api.registerJupyterPythonPathFunction !== undefined) {
                api.registerJupyterPythonPathFunction((uri) => this._jupyterPythonPathFunction(uri));
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
    public isPylanceUsingLspNotebooks() {
        if (this._isEnabled === undefined) {
            const isInNotebooksExperiment = this.configService.getSettings().pylanceLspNotebooksEnabled;
            const pythonVersion = extensions.getExtension(PythonExtension)?.packageJSON.version;
            const pylanceVersion = extensions.getExtension(PylanceExtension)?.packageJSON.version;

            // Only enable the experiment if we're in the treatment group and the installed
            // versions of Python and Pylance support the experiment.
            this._isEnabled =
                isInNotebooksExperiment &&
                pythonVersion &&
                (semver.gte(pythonVersion, '2022.7.0') || semver.prerelease(pythonVersion)?.includes('dev')) &&
                pylanceVersion &&
                (semver.gte(pylanceVersion, '2022.5.1-pre.1') || semver.prerelease(pylanceVersion)?.includes('dev'));

            traceInfo(`Pylance LSP Notebooks experiment is ${this._isEnabled ? "enabled" : "disabled"}.`);
        }

        return this._isEnabled;
    }

    /**
     * Called by the Python extension to give Jupyter a chance to override the python.exe
     * path used by Pylance. Return undefined to allow Python to determine the path.
     */
    private async _jupyterPythonPathFunction(uri: Uri): Promise<string | undefined> {
        const notebook = findAssociatedNotebookDocument(uri, this.notebooks, this.interactiveWindowProvider);
        if (!notebook) {
            traceVerbose(`_jupyterPythonPathFunction: "${uri}" is not a notebook`);
            return undefined;
        }

        const controller = this.notebookControllerManager.getSelectedNotebookController(notebook);
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
}
