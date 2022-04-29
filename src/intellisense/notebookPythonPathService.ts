// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { extensions, Uri } from 'vscode';
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

/**
* Manages use of the Python extension's registerJupyterPythonPathFunction API which
* enables us to provide the python.exe path for a notebook as required for Pylance's
* LSP-based notebooks support.
*/
@injectable()
export class NotebookPythonPathService implements IExtensionSingleActivationService {
    private _isEnabled: boolean | undefined;

    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

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
                pythonVersion !== undefined &&
                semver.satisfies(pythonVersion, '>=2022.6.0 || 2022.5.0-dev') &&
                pylanceVersion !== undefined &&
                semver.satisfies(pylanceVersion, '>=2022.4.4-pre.1 || 9999.0.0-dev');
        }

        return this._isEnabled;
    }

    /**
    * Called by the Python extension when Pylance needs the python.exe path for a notebook.
    */
    private async _jupyterPythonPathFunction(uri: Uri): Promise<string | undefined> {
        const notebook = findAssociatedNotebookDocument(uri, this.notebooks, this.interactiveWindowProvider);
        const controller = notebook
            ? this.notebookControllerManager.getSelectedNotebookController(notebook)
            : undefined;
        const interpreter = controller
            ? controller.connection.interpreter
            : await this.interpreterService.getActiveInterpreter(uri);

        if (!interpreter) {
            return undefined;
        }

        const pythonPath = getFilePath(interpreter.uri);
        return pythonPath;
    }
}
