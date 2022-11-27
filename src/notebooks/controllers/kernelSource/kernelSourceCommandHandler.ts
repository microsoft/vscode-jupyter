// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { commands, NotebookDocument, notebooks, window } from 'vscode';
import { ContributedKernelFinderKind } from '../../../kernels/internalTypes';
import { IJupyterUriProviderRegistration } from '../../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry, IFeaturesManager } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { ServiceContainer } from '../../../platform/ioc/container';
import { traceError } from '../../../platform/logging';
import { INotebookKernelSourceSelector } from '../types';

@injectable()
export class KernelSourceCommandHandler implements IExtensionSyncActivationService {
    private localDisposables: IDisposable[] = [];
    private readonly providerMappings = new Map<string, IDisposable[]>();
    constructor(
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        disposables.push(this);
    }
    public dispose() {
        disposeAllDisposables(this.localDisposables);
    }
    activate(): void {
        const updatePerFeature = () => {
            if (this.featuresManager.features.kernelPickerType === 'Insiders') {
                this._activate();
            } else {
                // clear disposables and provider mappings.
                disposeAllDisposables(this.localDisposables);
                this.localDisposables = [];
                this.providerMappings.clear();
            }
        };

        this.disposables.push(this.featuresManager.onDidChangeFeatures(() => updatePerFeature()));
        updatePerFeature();
    }
    private _activate() {
        this.localDisposables.push(
            notebooks.registerKernelSourceActionProvider(JupyterNotebookView, {
                provideNotebookKernelSourceActions: () => {
                    return [
                        {
                            label: DataScience.localKernelSpecs(),
                            detail: DataScience.pickLocalKernelSpecTitle(),
                            command: 'jupyter.kernel.selectLocalKernelSpec'
                        },
                        {
                            label: DataScience.localPythonEnvironments(),
                            detail: DataScience.pickLocalKernelPythonEnvTitle(),
                            command: 'jupyter.kernel.selectLocalPythonEnvironment'
                        }
                    ];
                }
            })
        );
        this.localDisposables.push(
            notebooks.registerKernelSourceActionProvider(InteractiveWindowView, {
                provideNotebookKernelSourceActions: () => {
                    return [
                        {
                            label: DataScience.localKernelSpecs(),
                            detail: DataScience.pickLocalKernelSpecTitle(),
                            command: 'jupyter.kernel.selectLocalKernelSpec'
                        },
                        {
                            label: DataScience.localPythonEnvironments(),
                            detail: DataScience.pickLocalKernelPythonEnvTitle(),
                            command: 'jupyter.kernel.selectLocalPythonEnvironment'
                        }
                    ];
                }
            })
        );
        this.localDisposables.push(
            commands.registerCommand(
                'jupyter.kernel.selectLocalKernelSpec',
                this.onSelectLocalKernel.bind(this, ContributedKernelFinderKind.LocalKernelSpec),
                this
            )
        );
        this.localDisposables.push(
            commands.registerCommand(
                'jupyter.kernel.selectLocalPythonEnvironment',
                this.onSelectLocalKernel.bind(this, ContributedKernelFinderKind.LocalPythonEnvironment),
                this
            )
        );
        this.localDisposables.push(
            commands.registerCommand('jupyter.kernel.selectJupyterServerKernel', this.onSelectRemoteKernel, this)
        );
        const uriRegistration = ServiceContainer.instance.get<IJupyterUriProviderRegistration>(
            IJupyterUriProviderRegistration
        );
        uriRegistration.onDidChangeProviders(() => this.registerUriCommands, this, this.localDisposables);
        this.registerUriCommands();
    }
    private registerUriCommands() {
        const uriRegistration = ServiceContainer.instance.get<IJupyterUriProviderRegistration>(
            IJupyterUriProviderRegistration
        );
        uriRegistration
            .getProviders()
            .then((providers) => {
                const existingItems = new Set<string>();
                providers.map((provider) => {
                    existingItems.add(provider.id);
                    if (this.providerMappings.has(provider.id)) {
                        return;
                    }
                    const providerItemNb = notebooks.registerKernelSourceActionProvider(JupyterNotebookView, {
                        provideNotebookKernelSourceActions: () => {
                            return [
                                {
                                    label: provider.displayName ?? provider.id,
                                    detail:
                                        provider.detail ??
                                        `Connect to Jupyter servers from ${provider.displayName ?? provider.id}`,
                                    command: {
                                        command: 'jupyter.kernel.selectJupyterServerKernel',
                                        arguments: [provider.id],
                                        title: provider.displayName ?? provider.id
                                    }
                                }
                            ];
                        }
                    });
                    const providerItemIW = notebooks.registerKernelSourceActionProvider(InteractiveWindowView, {
                        provideNotebookKernelSourceActions: () => {
                            return [
                                {
                                    label: provider.displayName ?? provider.id,
                                    detail:
                                        provider.detail ??
                                        `Connect to Jupyter servers from ${provider.displayName ?? provider.id}`,
                                    command: {
                                        command: 'jupyter.kernel.selectJupyterServerKernel',
                                        arguments: [provider.id],
                                        title: provider.displayName ?? provider.id
                                    }
                                }
                            ];
                        }
                    });
                    this.localDisposables.push(providerItemNb);
                    this.localDisposables.push(providerItemIW);
                    this.providerMappings.set(provider.id, [providerItemNb, providerItemIW]);
                });
                this.providerMappings.forEach((disposables, providerId) => {
                    if (!existingItems.has(providerId)) {
                        disposeAllDisposables(disposables);
                        this.providerMappings.delete(providerId);
                    }
                });
            })
            .catch((ex) => traceError(`Failed to register commands for remote Jupyter URI providers`, ex));
    }
    private async onSelectLocalKernel(
        kind: ContributedKernelFinderKind.LocalKernelSpec | ContributedKernelFinderKind.LocalPythonEnvironment,
        notebook?: NotebookDocument
    ) {
        notebook = notebook || window.activeNotebookEditor?.notebook;
        if (!notebook) {
            return;
        }
        const selector = ServiceContainer.instance.get<INotebookKernelSourceSelector>(INotebookKernelSourceSelector);
        const kernel = await selector.selectLocalKernel(notebook, kind);
        return kernel?.id;
    }
    private async onSelectRemoteKernel(providerId: string, notebook?: NotebookDocument) {
        notebook = notebook || window.activeNotebookEditor?.notebook;
        if (!notebook) {
            return;
        }
        const selector = ServiceContainer.instance.get<INotebookKernelSourceSelector>(INotebookKernelSourceSelector);
        const kernel = await selector.selectRemoteKernel(notebook, providerId);
        return kernel?.id;
    }
}
