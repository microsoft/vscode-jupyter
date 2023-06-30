// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, NotebookController, NotebookDocument, Uri } from 'vscode';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../kernels/types';
import { Deferred, createDeferred } from '../platform/common/utils/async';
import { noop } from '../platform/common/utils/misc';
import { InteractiveWindowMode, Resource } from '../platform/common/types';
import { IInteractiveControllerHelper } from './types';
import { IVSCodeNotebookController } from '../notebooks/controllers/types';
import { SystemInfoCell, getFinishConnectMessage, getStartConnectMessage } from './systemInfoCell';
import { traceError, traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { SysInfoReason } from '../messageTypes';
import { IDataScienceErrorHandler } from '../kernels/errors/types';

export class InteractiveWindowController {
    public kernel: Deferred<IKernel> | undefined;
    public controller: NotebookController | undefined;
    public metadata: KernelConnectionMetadata | undefined;
    private disposables: Disposable[] = [];
    private systemInfoCell: SystemInfoCell | undefined;
    private fileInKernel: Uri | undefined;
    private connectingListener: Disposable;

    constructor(
        private readonly controllerService: IInteractiveControllerHelper,
        private mode: InteractiveWindowMode,
        private readonly notebook: NotebookDocument,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly kernelProvider: IKernelProvider,
        private owner: Resource,
        controller: IVSCodeNotebookController | undefined
    ) {
        this.controller = controller?.controller;
        this.metadata = controller?.connection;
    }

    public updateMode(mode: InteractiveWindowMode) {
        this.mode = mode;
    }

    public updateOwners(file: Uri) {
        this.owner = file;
    }

    public async startKernel(): Promise<IKernel> {
        this.connectingListener?.dispose();
        if (this.kernel) {
            return this.kernel.promise;
        }
        if (!this.controller || !this.metadata) {
            throw new Error('Interactive Window kernel not selected');
        }

        this.setInfoMessage(this.metadata, SysInfoReason.Start);
        try {
            const kernel = await this.createKernel();
            const kernelEventHookForRestart = async () => {
                if (this.notebook && this.metadata) {
                    this.systemInfoCell = undefined;
                    // If we're about to restart, insert a 'restarting' message as it happens
                    this.setInfoMessage(this.metadata, SysInfoReason.Restart);
                }
            };
            // Hook pre interrupt so we can stick in a message
            this.disposables.push(kernel.addHook('willRestart', kernelEventHookForRestart));
            // When restart finishes, rerun our initialization code
            kernel.onRestarted(
                async () => {
                    traceVerbose('Restart event handled in IW');
                    this.fileInKernel = undefined;
                    try {
                        await this.setFileInKernel(kernel);
                    } catch (ex) {
                        traceError(`Failed to run initialization after restarting`);
                    } finally {
                        this.finishSysInfoMessage(kernel, SysInfoReason.Restart);
                    }
                },
                this,
                this.disposables
            );
            this.fileInKernel = undefined;
            await this.setFileInKernel(kernel);
            this.finishSysInfoMessage(kernel, SysInfoReason.Start);
            return kernel;
        } catch (ex) {
            if (this.owner) {
                // The actual error will be displayed in the cell, hence no need to display the actual
                // error here, else we'd just be duplicating the error messages.
                this.deleteSysInfoCell();
            } else {
                // We don't have a cell when starting IW without an *.py file,
                // hence display error where the sysinfo is displayed.
                await this.finishSysInfoWithFailureMessage(ex);
            }
            throw ex;
        }
    }

    private async createKernel(): Promise<IKernel> {
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
                this.owner,
                this.notebook!,
                this.disposables
            );
            this.metadata = kernel.kernelConnectionMetadata;
            this.controller = actualController;

            this.disposables.push(kernel);
            kernelPromise.resolve(kernel);
            return kernel;
        } catch (ex) {
            kernelPromise.reject(ex);
            this.disconnect();
            throw ex;
        }
    }

    private async setFileInKernel(kernel: IKernel): Promise<void> {
        const file = this.owner;
        if (!file) {
            traceInfoIfCI('Unable to run initialization for IW');
            return;
        }
        // If in perFile mode, set only once
        const path = getFilePath(file);
        const execution = this.kernelProvider.getKernelExecution(kernel!);
        if (this.mode === 'perFile' && !this.fileInKernel) {
            traceVerbose(`Initializing __file__ in setFileInKernel with ${file} for mode ${this.mode}`);
            this.fileInKernel = file;
            await execution.executeHidden(`__file__ = '${path.replace(/\\/g, '\\\\')}'`);
        } else if (
            (!this.fileInKernel || this.fileInKernel.toString() !== file.toString()) &&
            this.mode !== 'perFile'
        ) {
            traceVerbose(`Initializing __file__ in setFileInKernel with ${file} for mode ${this.mode}`);
            // Otherwise we need to reset it every time
            this.fileInKernel = file;
            await execution.executeHidden(`__file__ = '${path.replace(/\\/g, '\\\\')}'`);
        } else {
            traceVerbose(
                `Not Initializing __file__ in setFileInKernel with ${path} for mode ${this.mode} currently ${this.fileInKernel}`
            );
        }
    }

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
                    const previouslyConnected = !!this.kernel;
                    this.disconnect();
                    this.controller = e.controller.controller;
                    this.metadata = e.controller.connection;
                    if (previouslyConnected) {
                        this.startKernel().catch(noop);
                    } else {
                        this.connectingListener?.dispose();
                        this.connectingListener = e.controller.onConnecting(() => {
                            this.startKernel().catch(noop);
                        });
                    }
                }
            },
            this
        );
    }

    public setInfoMessageCell(message: string) {
        if (!this.systemInfoCell) {
            this.systemInfoCell = new SystemInfoCell(this.notebook, message);
        } else {
            this.systemInfoCell
                .updateMessage(message)
                .catch((error) =>
                    traceWarning(`could not update info cell with message: "${message}", error: ${error}`)
                );
        }
    }

    private setInfoMessage(metadata: KernelConnectionMetadata, reason: SysInfoReason) {
        const message = getStartConnectMessage(metadata, reason);
        this.setInfoMessageCell(message);
    }

    private finishSysInfoMessage(kernel: IKernel, reason: SysInfoReason) {
        const message = getFinishConnectMessage(kernel.kernelConnectionMetadata, reason);
        this.systemInfoCell
            ?.updateMessage(message)
            .catch((error) =>
                traceWarning(`System info message was not updated: "${message}" because of error: ${error}`)
            );
        this.systemInfoCell = undefined;
    }

    private async finishSysInfoWithFailureMessage(error: Error) {
        let message = await this.errorHandler.getErrorMessageForDisplayInCell(error, 'start', this.owner);
        // As message is displayed in markdown, ensure linebreaks are formatted accordingly.
        message = message.split('\n').join('  \n');
        this.systemInfoCell
            ?.updateMessage(message)
            .catch((error) =>
                traceWarning(`System info message was not updated: "${message}" because of error: ${error}`)
            );
        this.systemInfoCell = undefined;
    }

    private deleteSysInfoCell() {
        this.systemInfoCell?.deleteCell().then(noop, noop);
        this.systemInfoCell = undefined;
    }

    public disconnect() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.kernel = undefined;
    }
}

export class InteractiveControllerFactory {
    constructor(
        private readonly controllerService: IInteractiveControllerHelper,
        private readonly mode: InteractiveWindowMode,
        private readonly initialController?: IVSCodeNotebookController
    ) {}

    public create(
        notebook: NotebookDocument,
        errorHandler: IDataScienceErrorHandler,
        kernelProvider: IKernelProvider,
        owner: Resource
    ) {
        let controller = this.initialController;
        const selected = this.controllerService.getSelectedController(notebook);
        if (selected) {
            controller = selected;
        }

        return new InteractiveWindowController(
            this.controllerService,
            this.mode,
            notebook,
            errorHandler,
            kernelProvider,
            owner,
            controller
        );
    }
}
