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
    public kernel?: Deferred<IKernel>;
    private notebook: NotebookDocument | undefined;
    private autoStart = false;
    private disposables: Disposable[] = [];

    constructor(
        private readonly controllerService: IInteractiveControllerHelper,
        public controller?: NotebookController | undefined,
        public metadata?: KernelConnectionMetadata | undefined
    ) {}

    public get kernelDisposables() {
        return this.disposables;
    }

    public enableAutoStart() {
        this.autoStart = true;
    }

    public async startKernel(notebookDocument: NotebookDocument, owner?: Resource): Promise<IKernel> {
        if (this.kernel) {
            return this.kernel.promise;
        }
        if (!this.controller || !this.metadata) {
            throw new Error('Controller not selected');
        }

        this.notebook = notebookDocument;
        const kernelPromise = createDeferred<IKernel>();
        kernelPromise.promise.catch(noop);
        this.kernel = kernelPromise;

        try {
            // Try creating a kernel
            const { kernel, actualController } = await this.controllerService.createKernel(
                this.metadata,
                this.controller,
                owner,
                notebookDocument,
                this.kernelDisposables
            );
            this.metadata = kernel.kernelConnectionMetadata;
            this.controller = actualController;

            // let IW know to update info cell if metadata is different
            // this.updateSysInfoMessage(
            //     this.getSysInfoMessage(kernel.kernelConnectionMetadata, SysInfoReason.Start),
            //     false,
            //     sysInfoCell
            // );

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
    public setPendingCellAdd(cellAddedPromise: Promise<void>) {
        if (this.metadata && this.notebook) {
            const controller = this.controllerService.getRegisteredController(this.metadata);
            controller?.setPendingCellAddition(this.notebook, cellAddedPromise);
        }
    }

    public listenForControllerSelection() {
        return this.controllerService.onControllerSelected(
            (e: { notebook: NotebookDocument; controller: IVSCodeNotebookController }) => {
                if (e.notebook.uri.toString() !== this.notebook?.uri?.toString()) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                if (e.controller.id !== this.controller?.id) {
                    this.disconnect();
                    this.controller = e.controller.controller;
                    this.metadata = e.controller.connection;

                    // don't start the kernel if the IW has only been restored from a previous session
                    if (this.autoStart) {
                        this.startKernel(this.notebook).catch(noop);
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
