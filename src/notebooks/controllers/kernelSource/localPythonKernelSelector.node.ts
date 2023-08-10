// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, NotebookDocument, commands } from 'vscode';
import { ServiceContainer } from '../../../platform/ioc/container';
import { PythonKernelConnectionMetadata } from '../../../kernels/types';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import {
    getPythonEnvironmentCategory,
    pythonEnvironmentQuickPick
} from '../../../platform/interpreter/pythonEnvironmentPicker.node';
import { BaseProviderBasedQuickPick } from '../../../platform/common/providerBasedQuickPick';
import { Environment, ProposedExtensionAPI } from '../../../platform/api/pythonApiTypes';
import { DataScience } from '../../../platform/common/utils/localize';
import { PythonEnvKernelConnectionCreator } from '../pythonEnvKernelConnectionCreator.node';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { PythonEnvironmentQuickPickItemProvider } from '../../../platform/interpreter/pythonEnvironmentQuickPickProvider.node';
import { Disposables } from '../../../platform/common/utils';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { noop } from '../../../platform/common/utils/misc';
import { findPreferredPythonEnvironment } from '../preferredKernelConnectionService.node';
import { IPythonKernelFinder } from '../../../kernels/jupyter/types';
import { Commands } from '../../../platform/common/constants';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { IDisposable } from '../../../platform/common/types';
import { createDeferred } from '../../../platform/common/utils/async';
import { ILocalPythonNotebookKernelSourceSelector } from '../types';
import { injectable } from 'inversify';

@injectable()
export class LocalPythonKernelSelector extends Disposables implements ILocalPythonNotebookKernelSourceSelector {
    private readonly pythonEnvPicker: BaseProviderBasedQuickPick<Environment>;
    private readonly provider: PythonEnvironmentQuickPickItemProvider;
    private pythonApiPromise = createDeferred<ProposedExtensionAPI>();
    private pythonApi?: ProposedExtensionAPI;
    private readonly pythonKernelFinder: IPythonKernelFinder;
    private readonly pythonExtensionChecker: IPythonExtensionChecker;
    private readonly workspace: IWorkspaceService;
    private installPythonExtCommand?: IDisposable;
    private installPythonCommand?: IDisposable;
    private createPythonEnvCommand?: IDisposable;

    constructor() {
        super();
        const filter = ServiceContainer.instance.get<PythonEnvironmentFilter>(PythonEnvironmentFilter);
        this.pythonExtensionChecker = ServiceContainer.instance.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        this.workspace = ServiceContainer.instance.get<IWorkspaceService>(IWorkspaceService);
        this.pythonKernelFinder = ServiceContainer.instance.get<IPythonKernelFinder>(IPythonKernelFinder);

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
    }
    public async selectKernel(
        notebook: NotebookDocument,
        token: CancellationToken
    ): Promise<PythonKernelConnectionMetadata | typeof InputFlowAction.back | typeof InputFlowAction.cancel> {
        const pythonApiProvider = ServiceContainer.instance.get<IPythonApiProvider>(IPythonApiProvider);
        const setupApi = (api?: ProposedExtensionAPI) => {
            if (!api) {
                return;
            }
            this.pythonApiPromise.resolve(api);
            this.pythonApi = api;
            this.addNecessaryCommands(notebook, token);
            this.disposables.push(
                api.environments.onDidChangeEnvironments(() => this.addNecessaryCommands(notebook, token))
            );
        };
        if (this.pythonExtensionChecker.isPythonExtensionInstalled) {
            pythonApiProvider.getNewApi().then(setupApi).catch(noop);
        } else {
            this.pythonExtensionChecker.onPythonExtensionInstallationStatusChanged(
                () => pythonApiProvider.getNewApi().then(setupApi),
                this,
                this.disposables
            );
        }
        this.addNecessaryCommands(notebook, token);
        const computePreferredEnv = () => {
            if (!this.pythonApi || token.isCancellationRequested) {
                return;
            }
            this.pythonEnvPicker.recommended = findPreferredPythonEnvironment(notebook, this.pythonApi);
        };
        this.pythonApiPromise.promise
            .then((api) => {
                this.disposables.push(api.environments.onDidChangeActiveEnvironmentPath(computePreferredEnv));
                this.disposables.push(api.environments.onDidChangeEnvironments(computePreferredEnv));
            })
            .catch(noop);
        computePreferredEnv();
        const result = await this.pythonEnvPicker.selectItem(token);
        if (!result || result instanceof InputFlowAction) {
            return result || InputFlowAction.cancel;
        }
        return this.pythonKernelFinder.getOrCreateKernelConnection(result);
    }
    private addNecessaryCommands(notebook: NotebookDocument, token: CancellationToken) {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled && !this.installPythonExtCommand) {
            this.installPythonExtCommand = this.pythonEnvPicker.addCommand(
                {
                    label: DataScience.installPythonExtensionViaKernelPickerTitle,
                    tooltip: DataScience.installPythonExtensionViaKernelPickerToolTip
                },
                async () => {
                    // TODO: Once user installs Python wait here and refresh this UI so we display the Python Envs.
                    const installed = await commands.executeCommand(Commands.InstallPythonExtensionViaKernelPicker);
                    if (installed === true) {
                        // refresh the view and wait here
                        this.provider.refresh().catch(noop);
                        // TODO: Re-display the quick pick so user can pick a kernel.
                        return InputFlowAction.cancel;
                    } else {
                        return InputFlowAction.cancel;
                    }
                }
            );
        } else {
            this.installPythonExtCommand?.dispose();
            this.installPythonExtCommand = undefined;
        }

        if (
            this.provider.status === 'idle' &&
            this.pythonExtensionChecker.isPythonExtensionInstalled &&
            this.pythonApi &&
            this.workspace.isTrusted &&
            this.pythonApi.environments.known.length === 0
        ) {
            this.installPythonCommand = this.pythonEnvPicker.addCommand(
                {
                    label: DataScience.installPythonQuickPickTitle,
                    tooltip: DataScience.installPythonQuickPickToolTip,
                    detail: DataScience.pleaseReloadVSCodeOncePythonHasBeenInstalled
                },
                async () => {
                    // Timeout as we want the quick pick to close before we start this process.
                    setTimeout(() => commands.executeCommand(Commands.InstallPythonViaKernelPicker).then(noop, noop));
                    return InputFlowAction.cancel;
                }
            );
        } else {
            this.installPythonCommand?.dispose();
            this.installPythonCommand = undefined;
        }

        if (
            this.pythonApi?.environments?.known?.length &&
            this.pythonExtensionChecker.isPythonExtensionInstalled &&
            !this.createPythonEnvCommand
        ) {
            this.createPythonEnvCommand = this.pythonEnvPicker.addCommand(
                { label: `$(add) ${DataScience.createPythonEnvironmentInQuickPick}` },
                async () => this.createNewEnvironment(notebook, token)
            );
        } else {
            this.createPythonEnvCommand?.dispose();
            this.createPythonEnvCommand = undefined;
        }
    }

    private async createNewEnvironment(
        notebook: NotebookDocument,
        token: CancellationToken
    ): Promise<Environment | InputFlowAction | undefined> {
        const creator = new PythonEnvKernelConnectionCreator(notebook, token);
        this.disposables.push(creator);
        const result = await creator.createPythonEnvFromKernelPicker();
        if (!result) {
            return InputFlowAction.cancel;
        }
        if ('action' in result) {
            return result.action === 'Back' ? InputFlowAction.back : InputFlowAction.cancel;
        }
        return this.pythonApi?.environments?.known?.find((e) => e.id === result.kernelConnection.interpreter.id);
    }
}
