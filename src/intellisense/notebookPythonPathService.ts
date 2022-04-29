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

    public isEnabled() {
        if (this._isEnabled === undefined) {
            const isInNotebooksExperiment = this.configService.getSettings().pylanceLspNotebooksEnabled;
            const pythonVersion = extensions.getExtension(PythonExtension)?.packageJSON.version;
            const pylanceVersion = extensions.getExtension(PylanceExtension)?.packageJSON.version;

            this._isEnabled =
                isInNotebooksExperiment &&
                pythonVersion !== undefined &&
                semver.satisfies(pythonVersion, '>=2022.6.0 || 2022.5.0-dev') &&
                pylanceVersion !== undefined &&
                semver.satisfies(pylanceVersion, '>=2022.4.4-pre.1 || 9999.0.0-dev');
        }

        return this._isEnabled;
    }

    public async activate() {
        if (!this.isEnabled()) {
            return;
        }

        await this.apiProvider.getApi().then((api) => {
            api.registerJupyterPythonPathFunction((uri) => this.jupyterPythonPathFunction(uri));
        });
    }

    private async jupyterPythonPathFunction(uri: Uri): Promise<string | undefined> {
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
