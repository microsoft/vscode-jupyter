// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IServiceContainer } from '../../../platform/ioc/types';
import { CancellationTokenSource, workspace } from 'vscode';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { traceError } from '../../../platform/logging';
import {
    getPythonEnvironmentCategory,
    pythonEnvironmentQuickPick
} from '../../../platform/interpreter/pythonEnvironmentPicker.node';
import { JupyterInterpreterStateStore } from './jupyterInterpreterStateStore';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import { PlatformService } from '../../../platform/common/platform/platformService.node';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { DataScience } from '../../../platform/common/utils/localize';
import { ServiceContainer } from '../../../platform/ioc/container';
import { PythonEnvironmentQuickPickItemProvider } from '../../../platform/interpreter/pythonEnvironmentQuickPickProvider.node';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { isCondaEnvironmentWithoutPython } from '../../../platform/interpreter/helpers';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { BaseProviderBasedQuickPick } from '../../../platform/common/providerBasedQuickPick';

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
        const platformService = new PlatformService();
        const selectedInterpreter =
            this.serviceContainer.get<JupyterInterpreterStateStore>(JupyterInterpreterStateStore).selectedPythonPath;
        const filter = ServiceContainer.instance.get<PythonEnvironmentFilter>(PythonEnvironmentFilter);
        const provider = ServiceContainer.instance
            .get<PythonEnvironmentQuickPickItemProvider>(PythonEnvironmentQuickPickItemProvider)
            .withFilter((item) => !isCondaEnvironmentWithoutPython(item) && !filter.isPythonEnvironmentExcluded(item));
        const findSelectedEnvironment = () =>
            provider.items.find((item) =>
                areInterpreterPathsSame(item.executable.uri, selectedInterpreter, platformService.osType)
            );

        const placeholder = selectedInterpreter
            ? DataScience.currentlySelectedJupyterInterpreterForPlaceholder(
                  getDisplayPath(selectedInterpreter, workspace.workspaceFolders || [], platformService.homeDir)
              )
            : '';

        const disposables: IDisposable[] = [];

        const selector = new BaseProviderBasedQuickPick(
            provider,
            pythonEnvironmentQuickPick,
            getPythonEnvironmentCategory,
            { supportsBack: false }
        );
        selector.placeholder = placeholder;
        selector.selected = findSelectedEnvironment();
        disposables.push(selector);
        disposables.push(token);
        try {
            if (!selector.selected && selectedInterpreter) {
                const onDidChangeHandler = provider.onDidChange(() => {
                    selector.selected = findSelectedEnvironment();
                    if (selector.selected) {
                        onDidChangeHandler.dispose();
                    }
                });
                disposables.push(onDidChangeHandler);
            }

            const item = await selector.selectItem(token.token);
            if (!item || item instanceof InputFlowAction) {
                return;
            }
            return await this.serviceContainer
                .get<IInterpreterService>(IInterpreterService)
                .getInterpreterDetails(item.path);
        } catch (ex) {
            traceError(`Failed to select a Python Environment to start Jupyter`, ex);
        } finally {
            disposeAllDisposables(disposables);
        }
    }
}
