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
import { BaseProviderBasedQuickPick, CommandQuickPickItem } from '../../../platform/common/providerBasedQuickPick';
import { Environment } from '../../../platform/api/pythonApiTypes';
import { DataScience } from '../../../platform/common/utils/localize';
import { PythonEnvKernelConnectionCreator } from '../pythonEnvKernelConnectionCreator.node';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { PythonEnvironmentQuickPickItemProvider } from '../../../platform/interpreter/pythonEnvironmentQuickPickProvider.node';
import { Disposables } from '../../../platform/common/utils';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';

export class LocalPythonKernelSelector extends Disposables {
    private readonly pythonEnvPicker: BaseProviderBasedQuickPick<Environment>;
    constructor(
        private readonly notebook: NotebookDocument,
        private readonly token: CancellationToken
    ) {
        super();
        const filter = ServiceContainer.instance.get<PythonEnvironmentFilter>(PythonEnvironmentFilter);
        const provider = ServiceContainer.instance
            .get<PythonEnvironmentQuickPickItemProvider>(PythonEnvironmentQuickPickItemProvider)
            .withFilter((item) => !filter.isPythonEnvironmentExcluded(item));
        this.pythonEnvPicker = new BaseProviderBasedQuickPick(
            provider,
            pythonEnvironmentQuickPick,
            getPythonEnvironmentCategory,
            { supportsBack: true }
        );
        this.disposables.push(this.pythonEnvPicker);
        this.pythonEnvPicker.commands = [
            new CommandQuickPickItem<Environment>(
                `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`,
                this.createNewEnvironment.bind(this)
            )
        ];
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
