// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { ILocalResourceUriConverter } from '../../kernels/ipywidgets/types';
import { IKernelProvider, KernelConnectionMetadata } from '../../kernels/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import {
    IVSCodeNotebook,
    ICommandManager,
    IWorkspaceService,
    IDocumentManager,
    IApplicationShell
} from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { JupyterNotebookView, InteractiveWindowView } from '../../platform/common/constants';
import {
    IDisposableRegistry,
    IConfigurationService,
    IExtensionContext,
    IBrowserService
} from '../../platform/common/types';
import { IServiceContainer } from '../../platform/ioc/types';
import { traceError } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { NotebookCellLanguageService } from '../languages/cellLanguageService';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import { IControllerRegistration, InteractiveControllerIdSuffix, IVSCodeNotebookController } from './types';
import { VSCodeNotebookController } from './vscodeNotebookController';

/**
 * This class keeps track of registered controllers
 */
@injectable()
export class ControllerRegistration implements IControllerRegistration {
    private registeredControllers = new Map<string, VSCodeNotebookController>();
    private creationEmitter = new EventEmitter<IVSCodeNotebookController>();
    private registeredConnections = new Map<string, KernelConnectionMetadata>();

    public get onCreated(): Event<IVSCodeNotebookController> {
        return this.creationEmitter.event;
    }
    public get values(): IVSCodeNotebookController[] {
        return [...this.registeredControllers.values()];
    }
    public get connections(): KernelConnectionMetadata[] {
        return [...this.registeredConnections.values()];
    }
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(NotebookCellLanguageService) private readonly languageService: NotebookCellLanguageService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(ILocalResourceUriConverter) private readonly resourceConverter: ILocalResourceUriConverter
    ) {
        this.kernelFilter.onDidChange(this.onDidChangeKernelFilter, this, this.disposables);
    }
    add(
        metadata: KernelConnectionMetadata,
        types: ('jupyter-notebook' | 'interactive')[]
    ): IVSCodeNotebookController[] {
        let results: IVSCodeNotebookController[] = [];
        try {
            // Create notebook selector
            types
                .map((t) => {
                    return [this.getControllerId(metadata, t), t];
                })
                .filter(([id]) => {
                    // Update our list kernel connections.
                    this.registeredConnections.set(id, metadata);

                    // See if we already created this controller or not
                    const controller = this.registeredControllers.get(id);
                    if (controller) {
                        // If we already have this controller, its possible the Python version information has changed.
                        // E.g. we had a cached kernlespec, and since then the user updated their version of python,
                        // Now we need to update the display name of the kernelspec.
                        controller.updateConnection(metadata);
                        return false;
                    } else if (this.kernelFilter.isKernelHidden(metadata)) {
                        // Filter out those in our kernel filter
                        return false;
                    }
                    return true;
                })
                .forEach(([id, viewType]) => {
                    const controller = new VSCodeNotebookController(
                        metadata,
                        id,
                        viewType,
                        getDisplayNameOrNameOfKernelConnection(metadata),
                        this.notebook,
                        this.commandManager,
                        this.kernelProvider,
                        this.context,
                        this.disposables,
                        this.languageService,
                        this.workspace,
                        this.configuration,
                        this.docManager,
                        this.appShell,
                        this.browser,
                        this.extensionChecker,
                        this.resourceConverter,
                        this.serviceContainer
                    );
                    controller.onDidDispose(
                        () => {
                            this.registeredControllers.delete(controller.id);
                            this.registeredConnections.delete(controller.id);
                        },
                        this,
                        this.disposables
                    );
                    // We are disposing as documents are closed, but do this as well
                    this.disposables.push(controller);
                    this.registeredControllers.set(controller.id, controller);
                    results.push(controller);
                    this.creationEmitter.fire(controller);
                });
        } catch (ex) {
            if (isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                return results;
            }
            // We know that this fails when we have xeus kernels installed (untill that's resolved thats one instance when we can have duplicates).
            sendTelemetryEvent(
                Telemetry.FailedToCreateNotebookController,
                undefined,
                { kind: metadata.kind },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any,
                true
            );
            traceError(`Failed to create notebook controller for ${metadata.id}`, ex);
        }
        return results;
    }
    get(
        metadata: KernelConnectionMetadata,
        notebookType: 'jupyter-notebook' | 'interactive'
    ): IVSCodeNotebookController | undefined {
        const id = this.getControllerId(metadata, notebookType);
        return this.registeredControllers.get(id);
    }

    private getControllerId(
        metadata: KernelConnectionMetadata,
        viewType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ) {
        return viewType === JupyterNotebookView ? metadata.id : `${metadata.id}${InteractiveControllerIdSuffix}`;
    }

    private isControllerAttachedToADocument(controller: IVSCodeNotebookController) {
        return this.notebook.notebookDocuments.some((doc) => controller.isAssociatedWithDocument(doc));
    }

    private onDidChangeKernelFilter() {
        // Filter the connections.
        const connections = this.connections.filter((item) => !this.kernelFilter.isKernelHidden(item));

        // Try to re-create the missing controllers.
        connections.forEach((c) => this.add(c, [JupyterNotebookView, InteractiveWindowView]));

        // Go through all controllers that have been created and hide them.
        // Unless they are attached to an existing document.
        this.values.forEach((item) => {
            // TODO: Don't hide controllers that are already associated with a notebook.
            // If we have a notebook opened and its using a kernel.
            // Else we end up killing the execution as well.
            if (this.kernelFilter.isKernelHidden(item.connection) && !this.isControllerAttachedToADocument(item)) {
                item.dispose();
            }
        });
    }
}
