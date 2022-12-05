// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { isPythonNotebook } from '../../kernels/helpers';
import { IContributedKernelFinder } from '../../kernels/internalTypes';
import { computeServerId } from '../../kernels/jupyter/jupyterUtils';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IKernelFinder, isRemoteConnection, KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';
import { IDisposableRegistry, IFeaturesManager } from '../../platform/common/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { createActiveInterpreterController } from './helpers';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import { IControllerLoader, IControllerRegistration } from './types';

/**
 * This class finds and creates notebook controllers.
 */
@injectable()
export class ControllerLoader implements IControllerLoader, IExtensionSyncActivationService {
    // Promise to resolve when we have loaded our controllers
    private controllersPromise: Promise<void>;
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IControllerRegistration) private readonly registration: IControllerRegistration,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}

    public activate(): void {
        // Make sure to reload whenever we do something that changes state
        this.kernelFinder.onDidChangeKernels(() => this.loadControllers(), this, this.disposables);
        this.kernelFinder.registered.forEach((finder) => this.monitorDeletionOfConnections(finder));
        this.kernelFinder.onDidChangeRegistrations(
            (e) => e.added.forEach((finder) => this.monitorDeletionOfConnections(finder)),
            this,
            this.disposables
        );
        this.kernelFilter.onDidChange(this.onDidChangeFilter, this, this.disposables);
        this.serverUriStorage.onDidChangeConnectionType(this.onDidChangeFilter, this, this.disposables);
        this.serverUriStorage.onDidChangeUri(this.onDidChangeUri, this, this.disposables);
        this.serverUriStorage.onDidRemoveUris(this.onDidRemoveUris, this, this.disposables);

        this.interpreterService.onDidChangeInterpreter(
            this.deleteControllerAssociatedWithPythonEnvsNotLongerValid,
            this,
            this.disposables
        );
        this.interpreterService.onDidChangeInterpreters(
            this.deleteControllerAssociatedWithPythonEnvsNotLongerValid,
            this,
            this.disposables
        );

        this.registration.onChanged(
            ({ added }) => {
                added.forEach((controller) => {
                    controller.onNotebookControllerSelectionChanged(
                        (e) => {
                            if (
                                !e.selected &&
                                this.registration.isFiltered(controller.connection) &&
                                this.registration.canControllerBeDisposed(controller)
                            ) {
                                // This item was selected but is no longer allowed in the kernel list. Remove it
                                traceVerbose(`Removing controller ${controller.id} from kernel list`);
                                controller.dispose();
                            }
                        },
                        this,
                        this.disposables
                    );
                });
            },
            this,
            this.disposables
        );
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook).catch(noop));

        this.loadControllers();
        let previousKernelPickerType = this.featuresManager.features.kernelPickerType;
        this.featuresManager.onDidChangeFeatures(
            () => {
                if (previousKernelPickerType === this.featuresManager.features.kernelPickerType) {
                    return;
                }
                previousKernelPickerType = this.featuresManager.features.kernelPickerType;
                // With the old kernel picker some controllers can get disposed.
                // Hence to be on the safe side, when switching between the old and new kernel picker, reload the controllers.
                this.loadControllers();
            },
            this,
            this.disposables
        );
    }
    private async deleteControllerAssociatedWithPythonEnvsNotLongerValid() {
        // If an environment has been deleted, the refresh the list of interpreters
        // & wait for the kernels to detect the change.
        await this.interpreterService.refreshInterpreters();
        await new Promise<void>((resolve) => {
            if (this.kernelFinder.status === 'idle') {
                return resolve();
            }
            this.kernelFinder.onDidChangeStatus(
                () => {
                    if (this.kernelFinder.status === 'idle') {
                        return resolve();
                    }
                },
                this,
                this.disposables
            );
        });
        // Now that we've discovered all interpreters, we can remove any controllers that are associated with interpreters that no longer exist
        // E.g. its possible a user creates a virtual env and its selected as a active kernel for active interpreter
        // & subsequently the user deletes the virtual env.
        const validInterpreters = new Set(this.interpreterService.environments.map((i) => i.id));
        this.registration.registered.forEach((controller) => {
            const interpreterId = controller.connection.interpreter?.id;
            if (!interpreterId) {
                return;
            }
            if (!validInterpreters.has(interpreterId)) {
                // This means the interpreter no longer exists, hence remove the controller mapping.
                traceVerbose(
                    `Deleting controller ${controller.id} as it is associated with an interpreter ${interpreterId} that no longer exists, valid interpreters are ${validInterpreters}`
                );
                controller.dispose();
            }
        });
    }

    private loadControllers() {
        this.loadControllersImpl().ignoreErrors();
        sendKernelListTelemetry(this.registration.registered.map((v) => v.connection));

        traceInfoIfCI(`Providing notebook controllers with length ${this.registration.registered.length}.`);
    }
    public get loaded() {
        return this.controllersPromise;
    }
    private async onDidOpenNotebookDocument(document: vscode.NotebookDocument) {
        // Restrict to only our notebook documents
        if (
            (document.notebookType !== JupyterNotebookView && document.notebookType !== InteractiveWindowView) ||
            !vscode.workspace.isTrusted
        ) {
            return;
        }

        if (isPythonNotebook(getNotebookMetadata(document)) && this.extensionChecker.isPythonExtensionInstalled) {
            const useNewKernelPicker = this.featuresManager.features.kernelPickerType === 'Insiders';
            // No need to always display active python env in VS Codes controller list.
            if (!useNewKernelPicker) {
                // If we know we're dealing with a Python notebook, load the active interpreter as a kernel asap.
                createActiveInterpreterController(
                    JupyterNotebookView,
                    document.uri,
                    this.interpreters,
                    this.registration
                ).catch(noop);
            }
        }
    }

    private async loadControllersImpl() {
        this.controllersPromise = (async () => {
            if (this.extensionChecker.isPythonExtensionInstalled) {
                // This is temporary, when we create an MRU list in VS Code or the like, this should go away.
                // Debt https://github.com/microsoft/vscode-jupyter/issues/11988

                // First thing is to always create the controller for the active interpreter only if we don't have any remote connections.
                // This reduces flickering (changing controllers from one to another).
                const useNewKernelPicker = this.featuresManager.features.kernelPickerType === 'Insiders';
                if (this.serverUriStorage.isLocalLaunch && !useNewKernelPicker) {
                    await createActiveInterpreterController(
                        JupyterNotebookView,
                        undefined,
                        this.interpreters,
                        this.registration
                    );
                }
            }
            const connections = this.kernelFinder.kernels;
            traceVerbose(`Found ${connections.length} cached controllers`);
            this.createNotebookControllers(connections);

            traceInfoIfCI(
                `Kernels found in kernel finder include ${connections
                    .map((c) => `${c.kind}:${c.id}`)
                    .join('\n')} \n and currently registered controllers include ${this.registration.registered
                    .map((c) => `${c.connection.kind}:${c.connection.id}`)
                    .join('\n')}`
            );
            // Look for any controllers that we have disposed (no longer found when fetching)
            const disposedControllers = Array.from(this.registration.registered).filter((controller) => {
                const connectionIsStillValid = connections.some((connection) => {
                    return connection.id === controller.connection.id;
                });

                // Never remove remote kernels that don't exist.
                // Always leave them there for user to select, and if the connection is not available/not valid,
                // then notify the user and remove them.
                if (!connectionIsStillValid && controller.connection.kind === 'connectToLiveRemoteKernel') {
                    return true;
                }

                // Don't dispose this controller if it's attached to a document.
                if (!this.registration.canControllerBeDisposed(controller)) {
                    return false;
                }
                if (!connectionIsStillValid) {
                    traceVerbose(
                        `Controller ${controller.connection.kind}:'${controller.id}' for view = '${controller.viewType}' is no longer a valid`
                    );
                }
                return !connectionIsStillValid;
            });

            // If we have any out of date connections, dispose of them
            disposedControllers.forEach((controller) => {
                traceVerbose(
                    `Disposing old controller ${controller.connection.kind}:'${controller.id}' for view = '${controller.viewType}'`
                );
                controller.dispose(); // This should remove it from the registered list
            });
        })();

        // Set that we have loaded controllers
        this.controllersPromise = this.controllersPromise || Promise.resolve();
    }
    private createNotebookControllers(kernelConnections: KernelConnectionMetadata[]) {
        traceVerbose(`Creating ${kernelConnections?.length} controllers`);

        try {
            this.registration.batchAdd(kernelConnections, [JupyterNotebookView, InteractiveWindowView]);
        } catch (ex) {
            if (!isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                throw ex;
            }
        }
    }
    private async monitorDeletionOfConnections(finder: IContributedKernelFinder) {
        const eventHandler = finder.onDidChangeKernels(
            ({ removed: connections }) => {
                const deletedConnections = new Set((connections || []).map((item) => item.id));
                this.registration.registered
                    .filter((item) => deletedConnections.has(item.connection.id))
                    .forEach((controller) => {
                        traceVerbose(
                            `Deleting controller ${controller.id} as it is associated with a connection that has been deleted ${controller.connection.kind}:${controller.id}`
                        );
                        controller.dispose();
                    });
            },
            this,
            this.disposables
        );
        this.kernelFinder.onDidChangeRegistrations((e) => {
            if (e.removed.includes(finder)) {
                eventHandler.dispose();
            }
        });
    }

    private onDidChangeUri() {
        // This logic only applies to old kernel picker which supports local vs remote, not both and not multiple remotes.
        if (this.featuresManager.features.kernelPickerType === 'Stable') {
            // Our list of metadata could be out of date. Remove old ones that don't match the uri
            if (this.serverUriStorage.currentServerId) {
                this.registration.registered.forEach((c) => {
                    if (
                        isRemoteConnection(c.connection) &&
                        this.serverUriStorage.currentServerId !== c.connection.serverId
                    ) {
                        c.dispose();
                    }
                });
            }
        }
        // Update the list of controllers
        this.onDidChangeFilter();
    }

    private async onDidRemoveUris(uriEntries: IJupyterServerUriEntry[]) {
        // Remove any connections that are no longer available.
        const serverIds = await Promise.all(uriEntries.map((entry) => entry.uri).map(computeServerId));
        serverIds.forEach((serverId) => {
            this.registration.registered.forEach((c) => {
                if (isRemoteConnection(c.connection) && serverId === c.connection.serverId) {
                    c.dispose();
                }
            });
        });

        // Update list of controllers
        this.onDidChangeFilter();
    }

    private onDidChangeFilter() {
        // Give our list of metadata should be up to date, just remove the filtered ones
        const metadatas = this.registration.all.filter((item) => !this.registration.isFiltered(item));

        // Try to re-create the missing controllers.
        metadatas.forEach((c) => this.registration.addOrUpdate(c, [JupyterNotebookView, InteractiveWindowView]));

        // Go through all controllers that have been created and hide them.
        // Unless they are attached to an existing document.
        this.registration.registered.forEach((item) => {
            // TODO: Don't hide controllers that are already associated with a notebook.
            // If we have a notebook opened and its using a kernel.
            // Else we end up killing the execution as well.
            if (this.registration.isFiltered(item.connection) && this.registration.canControllerBeDisposed(item)) {
                item.dispose();
            }
        });
    }
}
