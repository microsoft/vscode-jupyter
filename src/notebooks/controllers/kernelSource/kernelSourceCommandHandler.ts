// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Command, commands, NotebookDocument, window } from 'vscode';
import { ContributedKernelFinderKind } from '../../../kernels/internalTypes';
import { IJupyterUriProviderRegistration } from '../../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { ServiceContainer } from '../../../platform/ioc/container';
import { traceError } from '../../../platform/logging';
import { INotebookKernelSourceSelector } from '../types';

interface KernelSourceProviderItem extends IDisposable {
    label: string;
    description?: string | boolean;
    id: string;
    command: Command;
}
@injectable()
export class KernelSourceCommandHandler implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly providerMappings = new Map<string, IDisposable>();
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    activate(): void {
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
                    const providerItem: KernelSourceProviderItem = {
                        command: {
                            command: '',
                            title: provider.displayName ?? provider.id,
                            arguments: [provider]
                        },
                        id: provider.id,
                        label: provider.displayName ?? provider.id,
                        description:
                            provider.detail ?? `Connect to Jupyter servers from ${provider.displayName ?? provider.id}`,
                        dispose: noop
                    };
                    this.providerMappings.set(provider.id, providerItem);
                });

                this.providerMappings.forEach((disposable, providerId) => {
                    if (!existingItems.has(providerId)) {
                        disposable.dispose();
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
}
