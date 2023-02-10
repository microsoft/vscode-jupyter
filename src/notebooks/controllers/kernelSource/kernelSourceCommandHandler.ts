// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationTokenSource,
    commands,
    EventEmitter,
    NotebookControllerAffinity,
    NotebookDocument,
    NotebookKernelSourceAction,
    notebooks,
    Uri,
    window
} from 'vscode';
import { DisplayOptions } from '../../../kernels/displayOptions';
import { isPythonKernelConnection } from '../../../kernels/helpers';
import { ContributedKernelFinderKind } from '../../../kernels/internalTypes';
import { IJupyterUriProviderRegistration } from '../../../kernels/jupyter/types';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../../../kernels/telemetry/helper';
import { sendKernelTelemetryEvent } from '../../../kernels/telemetry/sendKernelTelemetryEvent';
import {
    IKernelDependencyService,
    IKernelFinder,
    isLocalConnection,
    KernelConnectionMetadata
} from '../../../kernels/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { InteractiveWindowView, JupyterNotebookView, Telemetry } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry, IFeaturesManager, IsWebExtension } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { ServiceContainer } from '../../../platform/ioc/container';
import { traceError, traceWarning } from '../../../platform/logging';
import { IControllerRegistration, INotebookKernelSourceSelector, IVSCodeNotebookController } from '../types';

@injectable()
export class KernelSourceCommandHandler implements IExtensionSyncActivationService {
    private localDisposables: IDisposable[] = [];
    private readonly providerMappings = new Map<string, IDisposable[]>();
    private kernelSpecsSourceRegistered = false;
    constructor(
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IKernelDependencyService) private readonly kernelDependency: IKernelDependencyService
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
                this.kernelSpecsSourceRegistered = false;
            }
        };

        this.disposables.push(this.featuresManager.onDidChangeFeatures(() => updatePerFeature()));
        updatePerFeature();
    }
    private _activate() {
        if (!this.isWebExtension) {
            this.localDisposables.push(
                notebooks.registerKernelSourceActionProvider(JupyterNotebookView, {
                    provideNotebookKernelSourceActions: () => {
                        return [
                            {
                                label: DataScience.localPythonEnvironments,
                                documentation: Uri.parse('https://aka.ms/vscodeJupyterExtKernelPickerPythonEnv'),
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
                                label: DataScience.localPythonEnvironments,
                                documentation: Uri.parse('https://aka.ms/vscodeJupyterExtKernelPickerPythonEnv'),
                                command: 'jupyter.kernel.selectLocalPythonEnvironment'
                            }
                        ];
                    }
                })
            );

            let kernelSpecActions: NotebookKernelSourceAction[] = [];
            const kernelSpecActionChangeEmitter = new EventEmitter<void>();
            this.localDisposables.push(
                notebooks.registerKernelSourceActionProvider(JupyterNotebookView, {
                    onDidChangeNotebookKernelSourceActions: kernelSpecActionChangeEmitter.event,
                    provideNotebookKernelSourceActions: () => {
                        return kernelSpecActions;
                    }
                })
            );

            this.localDisposables.push(
                notebooks.registerKernelSourceActionProvider(InteractiveWindowView, {
                    onDidChangeNotebookKernelSourceActions: kernelSpecActionChangeEmitter.event,
                    provideNotebookKernelSourceActions: () => {
                        return kernelSpecActions;
                    }
                })
            );

            const registerKernelSpecsSource = () => {
                if (this.kernelSpecsSourceRegistered) {
                    return;
                }

                if (this.kernelFinder.kernels.some((k) => k.kind === 'startUsingLocalKernelSpec')) {
                    this.kernelSpecsSourceRegistered = true;
                    kernelSpecActions = [
                        {
                            label: DataScience.localKernelSpecs,
                            documentation: Uri.parse('https://aka.ms/vscodeJupyterExtKernelPickerJupyterKernels'),
                            command: 'jupyter.kernel.selectLocalKernelSpec'
                        }
                    ];

                    kernelSpecActionChangeEmitter.fire();
                }
            };

            registerKernelSpecsSource();
            this.kernelFinder.onDidChangeKernels(() => registerKernelSpecsSource(), this, this.localDisposables);
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
        }
        this.localDisposables.push(
            commands.registerCommand('jupyter.kernel.selectJupyterServerKernel', this.onSelectRemoteKernel, this)
        );
        const uriRegistration = ServiceContainer.instance.get<IJupyterUriProviderRegistration>(
            IJupyterUriProviderRegistration
        );
        uriRegistration.onDidChangeProviders(this.registerUriCommands, this, this.localDisposables);
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
                                    label:
                                        provider.displayName ??
                                        (provider.detail ? `${provider.detail} (${provider.id})` : provider.id),
                                    documentation: provider.id.startsWith('_builtin')
                                        ? Uri.parse('https://aka.ms/vscodeJuptyerExtKernelPickerExistingServer')
                                        : undefined,
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
                                    label:
                                        provider.displayName ??
                                        (provider.detail ? `${provider.detail} (${provider.id})` : provider.id),
                                    documentation: provider.id.startsWith('_builtin')
                                        ? Uri.parse('https://aka.ms/vscodeJuptyerExtKernelPickerExistingServer')
                                        : undefined,
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
        return this.getSelectedController(notebook, kernel);
    }
    private async onSelectRemoteKernel(providerId: string, notebook?: NotebookDocument) {
        notebook = notebook || window.activeNotebookEditor?.notebook;
        if (!notebook) {
            return;
        }
        const selector = ServiceContainer.instance.get<INotebookKernelSourceSelector>(INotebookKernelSourceSelector);
        const kernel = await selector.selectRemoteKernel(notebook, providerId);
        return this.getSelectedController(notebook, kernel);
    }
    private async getSelectedController(notebook: NotebookDocument, kernel?: KernelConnectionMetadata) {
        if (!kernel) {
            return;
        }
        const controllers = this.controllerRegistration.addOrUpdate(kernel, [
            notebook.notebookType as typeof JupyterNotebookView | typeof InteractiveWindowView
        ]);
        if (!Array.isArray(controllers) || controllers.length === 0) {
            traceWarning(`No controller created for selected kernel connection ${kernel.kind}:${kernel.id}`);
            return;
        }
        initializeInteractiveOrNotebookTelemetryBasedOnUserAction(notebook.uri, kernel)
            .finally(() =>
                sendKernelTelemetryEvent(notebook.uri, Telemetry.SwitchKernel, undefined, { newKernelPicker: true })
            )
            .catch(noop);
        controllers
            .find((item) => item.viewType === notebook.notebookType)
            ?.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity.Preferred);

        const controller = controllers[0];
        await this.onControllerSelected(notebook, controller);
        return controller.controller.id;
    }
    private async onControllerSelected(notebook: NotebookDocument, controller: IVSCodeNotebookController) {
        if (
            isLocalConnection(controller.connection) &&
            isPythonKernelConnection(controller.connection) &&
            controller.connection.interpreter?.isCondaEnvWithoutPython &&
            !this.isWebExtension
        ) {
            const disposables: IDisposable[] = [];
            try {
                const token = new CancellationTokenSource();
                disposables.push(token);
                const ui = new DisplayOptions(false);
                disposables.push(ui);
                await this.kernelDependency.installMissingDependencies({
                    resource: notebook.uri,
                    kernelConnection: controller.connection,
                    token: token.token,
                    ui,
                    cannotChangeKernels: true,
                    ignoreCache: true,
                    installWithoutPrompting: true
                });
            } catch (ex) {
                traceError(`Failed to install missing dependencies for Conda kernel ${controller.connection.id}`, ex);
            } finally {
                disposeAllDisposables(disposables);
            }
        }
    }
}
