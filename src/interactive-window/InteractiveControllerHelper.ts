// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Disposable, Memento, NotebookController, NotebookDocument, Event } from 'vscode';
import { DisplayOptions } from '../kernels/displayOptions';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../kernels/telemetry/helper';
import { IKernel, KernelAction, KernelConnectionMetadata } from '../kernels/types';
import { createActiveInterpreterController, isActiveInterpreter } from '../notebooks/controllers/helpers';
import { KernelConnector } from '../notebooks/controllers/kernelConnector';
import { IControllerRegistration, IVSCodeNotebookController } from '../notebooks/controllers/types';
import { InteractiveWindowView } from '../platform/common/constants';
import { IDisposableRegistry, IMemento, Resource, WORKSPACE_MEMENTO } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { IServiceContainer } from '../platform/ioc/types';
import { traceInfoIfCI, traceWarning } from '../platform/logging';
import { IInteractiveControllerHelper } from './types';

const MostRecentKernelSelectedKey = 'LastInteractiveKernelSelected';

@injectable()
export class InteractiveControllerHelper implements IInteractiveControllerHelper {
    constructor(
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IDisposableRegistry) readonly disposables: IDisposableRegistry,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private workspaceMemento: Memento,
        @inject(IServiceContainer) private serviceContainer: IServiceContainer
    ) {
        this.onControllerSelected = this.controllerRegistration.onControllerSelected;
    }

    public readonly onControllerSelected: Event<{
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
    }>;

    public async getInitialController(resource: Resource, preferredConnection?: KernelConnectionMetadata) {
        // If given a preferred connection, use that if it exists
        if (preferredConnection) {
            const controller = this.controllerRegistration.get(preferredConnection, InteractiveWindowView);
            if (controller) {
                return controller;
            }
        }

        // If a kernel was previously selected for an IW, use that again if it still exists
        if (this.workspaceMemento.get(MostRecentKernelSelectedKey)) {
            const metadata = this.workspaceMemento.get<KernelConnectionMetadata>(MostRecentKernelSelectedKey);
            const controller = metadata ? this.controllerRegistration.get(metadata, InteractiveWindowView) : undefined;
            if (controller) {
                return controller;
            }
        }

        // Just use the active interpreter
        return await createActiveInterpreterController(
            InteractiveWindowView,
            resource,
            this.interpreterService,
            this.controllerRegistration
        );
    }

    public getSelectedController(notebookDocument: NotebookDocument): IVSCodeNotebookController | undefined {
        return this.controllerRegistration.getSelected(notebookDocument);
    }

    public getRegisteredController(metadata: KernelConnectionMetadata): IVSCodeNotebookController | undefined {
        return this.controllerRegistration.get(metadata, 'interactive');
    }

    public async createKernel(
        metadata: KernelConnectionMetadata,
        controller: NotebookController,
        resource: Resource,
        notebookDocument: NotebookDocument,
        disposables: Disposable[]
    ): Promise<{ kernel: IKernel; actualController: NotebookController }> {
        await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(resource, metadata);

        const onStartKernel = (action: KernelAction, k: IKernel) => {
            if (action !== 'start' && action !== 'restart') {
                return;
            }
            // Id may be different if the user switched controllers
            traceInfoIfCI(
                `(onStart) Looking for controller ${k.controller.id} in ${this.controllerRegistration.all
                    .map((item) => `${item.kind}:${item.id}`)
                    .join(', ')}`
            );
        };

        const kernel = await KernelConnector.connectToNotebookKernel(
            metadata,
            this.serviceContainer,
            { resource: resource || notebookDocument.uri, notebook: notebookDocument, controller },
            new DisplayOptions(false),
            disposables,
            'jupyterExtension',
            onStartKernel
        );

        const found = this.controllerRegistration.registered.find((item) => item.id === kernel.controller.id);
        if (!found) {
            throw Error(`Controller ${kernel.controller.id} not found or not yet created`);
        }
        const actualController = found.controller;

        // save the kernel info if not the active interpreter
        isActiveInterpreter(kernel.kernelConnectionMetadata, resource, this.interpreterService)
            .then(async (isActiveInterpreter) => {
                await this.workspaceMemento.update(
                    MostRecentKernelSelectedKey,
                    isActiveInterpreter ? undefined : kernel.kernelConnectionMetadata
                );
            })
            .catch((reason) => {
                traceWarning('Failed to store kernel connection metadata', reason);
            });

        return { kernel, actualController };
    }
}
