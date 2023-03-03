// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, NotebookController, NotebookDocument } from 'vscode';
import { IKernel, KernelConnectionMetadata } from '../kernels/types';
import { Deferred, createDeferred } from '../platform/common/utils/async';
import { noop } from '../platform/common/utils/misc';
import { Resource } from '../platform/common/types';
import { IInteractiveControllerHelper } from './types';
import { IVSCodeNotebookController } from '../notebooks/controllers/types';

export class InteractiveWindowController {
    public kernel: Deferred<IKernel> | undefined;
    public controller: NotebookController | undefined;
    public metadata: KernelConnectionMetadata | undefined;
    private notebook: NotebookDocument | undefined;
    private autoStart = false;
    private disposables: Disposable[] = [];

    constructor(private readonly controllerService: IInteractiveControllerHelper) {}

    public get kernelDisposables() {
        return this.disposables;
    }

    public enableAutoStart() {
        this.autoStart = true;
    }

    public setController(notebook: NotebookDocument) {
        if (!this.controller || !this.metadata) {
            this.notebook = notebook;
            const selected = this.controllerService.getSelectedController(notebook);
            this.controller = selected?.controller;
            this.metadata = selected?.connection;
        }
    }

    public async startKernel(owner?: Resource): Promise<IKernel> {
        if (this.kernel) {
            return this.kernel.promise;
        }
        if (!this.controller || !this.metadata) {
            throw new Error('Controller not selected');
        }

        const kernelPromise = createDeferred<IKernel>();
        kernelPromise.promise.catch(noop);
        this.kernel = kernelPromise;

        try {
            // Try creating a kernel
            const { kernel, actualController } = await this.controllerService.createKernel(
                this.metadata,
                this.controller,
                owner,
                this.notebook!,
                this.kernelDisposables
            );
            this.metadata = kernel.kernelConnectionMetadata;
            this.controller = actualController;

            this.kernelDisposables.push(kernel);
            kernelPromise.resolve(kernel);
            return kernel;
        } catch (ex) {
            kernelPromise.reject(ex);
            this.disconnect();
            throw ex;
        }
    }

    /**
     * Inform the controller that a cell is being added and it should wait before adding any others to the execution queue.
     * @param cellAddedPromise - Promise that resolves when the cell execution has been queued
     */
    // TODO: pending cell add only deals with IW, so move that all in here.
    public setPendingCellAdd(cellAddedPromise: Promise<void>) {
        if (this.metadata && this.notebook) {
            const controller = this.controllerService.getRegisteredController(this.metadata);
            controller?.setPendingCellAddition(this.notebook, cellAddedPromise);
        }
    }

    public listenForControllerSelection() {
        return this.controllerService.onControllerSelected(
            (e: { notebook: NotebookDocument; controller: IVSCodeNotebookController }) => {
                if (!this.notebook || e.notebook.uri.toString() !== this.notebook?.uri?.toString()) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                if (e.controller.id !== this.controller?.id) {
                    this.disconnect();
                    this.controller = e.controller.controller;
                    this.metadata = e.controller.connection;

                    // don't start the kernel if the IW has only been restored from a previous session
                    if (this.autoStart) {
                        this.startKernel().catch(noop);
                    }
                }
            },
            this
        );
    }

    public disconnect() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.kernel = undefined;
    }
}
