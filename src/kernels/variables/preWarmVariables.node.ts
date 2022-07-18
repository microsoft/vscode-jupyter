// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker, IPythonApiProvider } from '../../platform/api/types';
import { IWorkspaceService } from '../../platform/common/application/types';
import { CondaService } from '../../platform/common/process/condaService.node';
import { IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { IEnvironmentVariablesProvider } from '../../platform/common/variables/types';
import { IEnvironmentActivationService } from '../../platform/interpreter/activation/types';
import { JupyterInterpreterService } from '../jupyter/interpreter/jupyterInterpreterService.node';
import { IRawNotebookSupportedService } from '../raw/types';

/**
 * Computes interpreter environment variables when starting up.
 */
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
                this.envVarsProvider.getEnvironmentVariables(undefined).ignoreErrors();
                (this.workspace.workspaceFolders || []).forEach((folder) => {
                    this.envVarsProvider.getEnvironmentVariables(folder.uri).ignoreErrors();
                });
            }
            this.condaService.getCondaFile().ignoreErrors();
            this.condaService.getCondaVersion().ignoreErrors();
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
