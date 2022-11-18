// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { inject, injectable } from 'inversify';
import { commands, NotebookDocument, notebooks, window } from 'vscode';
import { ContributedKernelFinderKind } from '../../../kernels/internalTypes';
import { IJupyterUriProviderRegistration } from '../../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry, IFeaturesManager } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { ServiceContainer } from '../../../platform/ioc/container';
import { traceError } from '../../../platform/logging';
import { INotebookKernelSourceSelector } from '../types';

@injectable()
export class KernelSourceCommandHandler implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly providerMappings = new Map<string, IDisposable[]>();
    constructor(
        @inject(IFeaturesManager) private readonly features: IFeaturesManager,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    activate(): void {
        if (this.features.features.kernelPickerType !== 'Insiders') {
            return;
        }
        this.disposables.push(
            notebooks.registerKernelSourceActionProvider('jupyter-notebook', {
                provideNotebookKernelSourceActions: () => {
                    return [
                        {
                            label: DataScience.localKernelSpecs(),
                            detail: DataScience.pickLocalKernelSpecTitle(),
                            command: 'jupyter.kernel.selectLocalKernelSpec' as any
                        },
                        {
                            label: DataScience.localPythonEnvironments(),
                            detail: DataScience.pickLocalKernelPythonEnvTitle(),
                            command: 'jupyter.kernel.selectLocalPythonEnvironment' as any
                        }
                    ];
                }
            })
        );
        this.disposables.push(
            commands.registerCommand(
                'jupyter.kernel.selectLocalKernelSpec',
                this.onSelectLocalKernel.bind(this, ContributedKernelFinderKind.LocalKernelSpec),
                this
            )
        );
        this.disposables.push(
            commands.registerCommand(
                'jupyter.kernel.selectLocalPythonEnvironment',
                this.onSelectLocalKernel.bind(this, ContributedKernelFinderKind.LocalPythonEnvironment),
                this
            )
        );
        this.disposables.push(
            commands.registerCommand('jupyter.kernel.selectJupyterServerKernel', this.onSelectRemoteKernel, this)
        );
        const uriRegistration = ServiceContainer.instance.get<IJupyterUriProviderRegistration>(
            IJupyterUriProviderRegistration
        );
        uriRegistration.onDidChangeProviders(() => this.registerUriCommands, this, this.disposables);
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
                    const providerItem = notebooks.registerKernelSourceActionProvider('jupyter-notebook', {
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
                    this.disposables.push(providerItem);
                    this.providerMappings.set(provider.id, [providerItem]);
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
