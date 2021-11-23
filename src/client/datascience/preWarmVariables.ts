// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../api/types';
import { IWorkspaceService } from '../common/application/types';
import '../common/extensions';
import { IDisposableRegistry } from '../common/types';
import { noop } from '../common/utils/misc';
import { IEnvironmentVariablesProvider } from '../common/variables/types';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { JupyterInterpreterService } from './jupyter/interpreter/jupyterInterpreterService';
import { IRawNotebookSupportedService } from './types';

@injectable()
export class PreWarmActivatedJupyterEnvironmentVariables implements IExtensionSingleActivationService {
    constructor(
        @inject(IEnvironmentActivationService) private readonly activationService: IEnvironmentActivationService,
        @inject(JupyterInterpreterService) private readonly jupyterInterpreterService: JupyterInterpreterService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IRawNotebookSupportedService) private readonly rawNotebookSupported: IRawNotebookSupportedService,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsProvider: IEnvironmentVariablesProvider,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}
    public async activate(): Promise<void> {
        // Don't prewarm global interpreter if running with ZMQ
        if (!this.rawNotebookSupported.isSupported) {
            this.disposables.push(
                this.jupyterInterpreterService.onDidChangeInterpreter(() =>
                    this.preWarmInterpreterVariables().catch(noop)
                )
            );
            this.preWarmInterpreterVariables().ignoreErrors();
            this.apiProvider.onDidActivatePythonExtension(this.preWarmInterpreterVariables, this, this.disposables);
        }

        // Don't try to pre-warm variables if user has too many workspace folders opened.
        const workspaceFolderCount = this.workspace.workspaceFolders?.length ?? 0;
        if (workspaceFolderCount <= 5) {
            void this.envVarsProvider.getEnvironmentVariables(undefined);
            (this.workspace.workspaceFolders || []).forEach((folder) => {
                void this.envVarsProvider.getEnvironmentVariables(folder.uri);
            });
        }
    }

    private async preWarmInterpreterVariables() {
        if (!this.extensionChecker.isPythonExtensionActive) {
            return;
        }
        const interpreter = await this.jupyterInterpreterService.getSelectedInterpreter();
        if (!interpreter) {
            return;
        }
        this.activationService.getActivatedEnvironmentVariables(undefined, interpreter).ignoreErrors();
    }
}
