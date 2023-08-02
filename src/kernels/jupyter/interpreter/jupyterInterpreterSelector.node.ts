// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
// eslint-disable-next-line import/no-restricted-paths
import { ILocalPythonNotebookKernelSourceSelector } from '../../../notebooks/controllers/types';
import { IServiceContainer } from '../../../platform/ioc/types';

/**
 * Displays interpreter select and returns the selection to the user.
 *
 * @export
 * @class JupyterInterpreterSelector
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
        const selector = this.serviceContainer.get<ILocalPythonNotebookKernelSourceSelector>(
            ILocalPythonNotebookKernelSourceSelector
        );
        const kernel = await selector.selectLocalKernel(undefined);
        return kernel?.interpreter;
    }
}
