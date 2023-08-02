// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IServiceContainer } from '../../../platform/ioc/types';
import { CancellationTokenSource } from 'vscode';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { traceError } from '../../../platform/logging';
import { PythonEnvironmentPicker } from '../../../platform/interpreter/pythonEnvironmentPicker.node';

/**
 * Displays interpreter select and returns the selection to the user.
 */
@injectable()
export class JupyterInterpreterSelector {
    constructor(
        @inject(IServiceContainer)
        private readonly serviceContainer: IServiceContainer
    ) {}
    /**
     * Displays interpreter selector and returns the selection.
     */
    public async selectInterpreter(): Promise<PythonEnvironment | undefined> {
        const token = new CancellationTokenSource();
        const selector = new PythonEnvironmentPicker({
            token: token.token,
            supportsBack: false
        });
        try {
            const item = await selector.selectItem();
            if (item && !(item instanceof InputFlowAction)) {
                const interpreter = await this.serviceContainer
                    .get<IInterpreterService>(IInterpreterService)
                    .getInterpreterDetails(item.path);
                if (!interpreter) {
                    return;
                }
                return interpreter;
            }
        } catch (ex) {
            traceError(`Failed to select a Python Environment to start Jupyter`, ex);
        } finally {
            selector.dispose();
            token.dispose();
        }
    }
}
