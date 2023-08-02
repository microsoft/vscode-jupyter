// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { Environment } from '../../../../platform/api/pythonApiTypes';
import { ServiceContainer } from '../../../../platform/ioc/container';
import { PythonKernelConnectionMetadata } from '../../../../kernels/types';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';
import { JupyterPaths } from '../../../../kernels/raw/finder/jupyterPaths.node';
import { createInterpreterKernelSpec, getKernelId } from '../../../../kernels/helpers';
import { InputFlowAction } from '../../../../platform/common/utils/multiStepInput';
import { BaseProviderBasedQuickPick } from '../../../../platform/common/providerBasedQuickPick';
import { PythonEnvironmentPicker } from '../../../../platform/interpreter/pythonEnvironmentPicker.node';

export class PythonKernelSelector {
    private readonly pythonEnvSelector: BaseProviderBasedQuickPick<Environment>;
    constructor(token: CancellationToken) {
        this.pythonEnvSelector = new PythonEnvironmentPicker({
            token,
            supportsBack: true
        });
    }

    public async selectItem(): Promise<
        | { selection: 'item'; item: PythonKernelConnectionMetadata }
        | { selection: 'userPerformedSomeOtherAction' }
        | undefined
    > {
        const result = await this.pythonEnvSelector.selectItem();
        if (result && !(result instanceof InputFlowAction)) {
            const interpreters = ServiceContainer.instance.get<IInterpreterService>(IInterpreterService);
            const jupyterPaths = ServiceContainer.instance.get<JupyterPaths>(JupyterPaths);
            const interpreter = await interpreters.getInterpreterDetails(result.path);
            if (!interpreter) {
                return;
            }
            const spec = await createInterpreterKernelSpec(
                interpreter,
                await jupyterPaths.getKernelSpecTempRegistrationFolder()
            );
            const connection = PythonKernelConnectionMetadata.create({
                kernelSpec: spec,
                interpreter: interpreter,
                id: getKernelId(spec, interpreter)
            });
            return { item: connection, selection: 'item' };
        }
        return;
    }
}
