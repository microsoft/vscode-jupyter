// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, NotebookDocument } from 'vscode';
import { ServiceContainer } from '../../../platform/ioc/container';
import { PythonKernelConnectionMetadata } from '../../../kernels/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { JupyterPaths } from '../../../kernels/raw/finder/jupyterPaths.node';
import { createInterpreterKernelSpec, getKernelId } from '../../../kernels/helpers';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import {
    getPythonEnvironmentCategory,
    pythonEnvironmentQuickPick
} from '../../../platform/interpreter/pythonEnvironmentPicker.node';
import { BaseProviderBasedQuickPick } from '../../../platform/common/providerBasedQuickPick';
import { Environment, PythonExtension } from '@vscode/python-extension';
import { DataScience } from '../../../platform/common/utils/localize';
import { PythonEnvKernelConnectionCreator } from '../pythonEnvKernelConnectionCreator.node';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { PythonEnvironmentQuickPickItemProvider } from '../../../platform/interpreter/pythonEnvironmentQuickPickProvider.node';
import { Disposables } from '../../../platform/common/utils';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { noop } from '../../../platform/common/utils/misc';
import { findPreferredPythonEnvironment } from '../preferredKernelConnectionService.node';

export class LocalPythonKernelSelector extends Disposables {
    private readonly pythonEnvPicker: BaseProviderBasedQuickPick<Environment>;
    private readonly provider: PythonEnvironmentQuickPickItemProvider;
    private pythonApi?: PythonExtension;
    constructor(
        private readonly notebook: NotebookDocument,
        private readonly token: CancellationToken
    ) {
        super();
        const filter = ServiceContainer.instance.get<PythonEnvironmentFilter>(PythonEnvironmentFilter);
        const pythonExtensionChecker = ServiceContainer.instance.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        const pythonApiProvider = ServiceContainer.instance.get<IPythonApiProvider>(IPythonApiProvider);

        this.provider = ServiceContainer.instance
            .get<PythonEnvironmentQuickPickItemProvider>(PythonEnvironmentQuickPickItemProvider)
            .withFilter((item) => !filter.isPythonEnvironmentExcluded(item));
        this.pythonEnvPicker = new BaseProviderBasedQuickPick(
            Promise.resolve(this.provider),
            pythonEnvironmentQuickPick,
            getPythonEnvironmentCategory,
            { supportsBack: true }
        );
        this.disposables.push(this.pythonEnvPicker);
        this.pythonEnvPicker.addCommand(
            { label: `$(add) ${DataScience.createPythonEnvironmentInQuickPick}` },
            this.createNewEnvironment.bind(this)
        );
        const computePreferredEnv = () => {
            if (!this.pythonApi || token.isCancellationRequested) {
                return;
            }
            this.pythonEnvPicker.recommended = findPreferredPythonEnvironment(this.notebook, this.pythonApi);
            console.log(1234);
        };
        const setupApi = (api?: PythonExtension) => {
            if (!api) {
                return;
            }
            this.pythonApi = api;
            computePreferredEnv();
            this.disposables.push(api.environments.onDidChangeActiveEnvironmentPath(computePreferredEnv));
            this.disposables.push(api.environments.onDidChangeEnvironments(computePreferredEnv));
        };
        if (pythonExtensionChecker.isPythonExtensionInstalled) {
            pythonApiProvider.getNewApi().then(setupApi).catch(noop);
        } else {
            pythonExtensionChecker.onPythonExtensionInstallationStatusChanged(
                () => pythonApiProvider.getNewApi().then(setupApi),
                this,
                this.disposables
            );
        }

        computePreferredEnv();
    }

    public async selectKernel(): Promise<
        PythonKernelConnectionMetadata | typeof InputFlowAction.back | typeof InputFlowAction.cancel
    > {
        const result = await this.pythonEnvPicker.selectItem(this.token);
        if (!result || result instanceof InputFlowAction) {
            return result || InputFlowAction.cancel;
        }
        const interpreters = ServiceContainer.instance.get<IInterpreterService>(IInterpreterService);
        const jupyterPaths = ServiceContainer.instance.get<JupyterPaths>(JupyterPaths);
        const interpreter = await interpreters.getInterpreterDetails(result.path);
        if (!interpreter) {
            return InputFlowAction.cancel;
        }
        const spec = await createInterpreterKernelSpec(
            interpreter,
            await jupyterPaths.getKernelSpecTempRegistrationFolder()
        );
        return PythonKernelConnectionMetadata.create({
            kernelSpec: spec,
            interpreter: interpreter,
            id: getKernelId(spec, interpreter)
        });
    }

    private async createNewEnvironment(): Promise<Environment | InputFlowAction | undefined> {
        const apiProvider = ServiceContainer.instance.get<IPythonApiProvider>(IPythonApiProvider);
        const extChecker = ServiceContainer.instance.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        if (!extChecker.isPythonExtensionInstalled) {
            return;
        }

        const creator = new PythonEnvKernelConnectionCreator(this.notebook, this.token);
        this.disposables.push(creator);
        const result = await creator.createPythonEnvFromKernelPicker();
        if (!result) {
            return InputFlowAction.cancel;
        }
        if ('action' in result) {
            return result.action === 'Back' ? InputFlowAction.back : InputFlowAction.cancel;
        }
        const api = await apiProvider.getNewApi();
        return api?.environments.known.find((e) => e.id === result.kernelConnection.interpreter.id);
    }
}
