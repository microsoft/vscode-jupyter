// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { noop } from 'rxjs';
import { IExtensionSingleActivationService } from '../../client/activation/types';
import { IPythonExtensionChecker, IPythonApiProvider } from '../../client/api/types';
import { IWorkspaceService } from '../../client/common/application/types';
import { CondaService } from '../../client/common/process/condaService';
import { IDisposableRegistry } from '../../client/common/types';
import { IEnvironmentVariablesProvider } from '../../client/common/variables/types';
import { IRawNotebookSupportedService } from '../../client/datascience/types';
import { IEnvironmentActivationService } from '../../client/interpreter/activation/types';
import { JupyterInterpreterService } from '../jupyter/interpreter/jupyterInterpreterService';

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
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(CondaService) private readonly condaService: CondaService,
        @inject(IPythonExtensionChecker) private readonly pythonChecker: IPythonExtensionChecker
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
        if (this.pythonChecker.isPythonExtensionInstalled) {
            // Don't try to pre-warm variables if user has too many workspace folders opened.
            const workspaceFolderCount = this.workspace.workspaceFolders?.length ?? 0;
            if (workspaceFolderCount <= 5) {
                void this.envVarsProvider.getEnvironmentVariables(undefined);
                (this.workspace.workspaceFolders || []).forEach((folder) => {
                    void this.envVarsProvider.getEnvironmentVariables(folder.uri);
                });
            }
            void this.condaService.getCondaFile();
            void this.condaService.getCondaVersion();
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
