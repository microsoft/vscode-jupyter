// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, NotebookController, NotebookDocument, Uri } from 'vscode';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../kernels/types';
import { Deferred, createDeferred } from '../platform/common/utils/async';
import { noop } from '../platform/common/utils/misc';
import { InteractiveWindowMode, Resource } from '../platform/common/types';
import { IInteractiveControllerHelper } from './types';
import { IVSCodeNotebookController } from '../notebooks/controllers/types';
import { SystemInfoCell, getSysInfoMessage } from './systemInfoCell';
import { traceError, traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { SysInfoReason } from '../messageTypes';
import { DataScience } from '../platform/common/utils/localize';
import { IDataScienceErrorHandler } from '../kernels/errors/types';
import { getDisplayNameOrNameOfKernelConnection } from '../kernels/helpers';

export class InteractiveWindowController {
    public kernel: Deferred<IKernel> | undefined;
    public controller: NotebookController | undefined;
    public metadata: KernelConnectionMetadata | undefined;
    private notebook: NotebookDocument | undefined;
    private autoStart = false;
    private disposables: Disposable[] = [];
    private systemInfoCell: SystemInfoCell | undefined;
    private fileInKernel: Uri | undefined;

    constructor(
        private readonly controllerService: IInteractiveControllerHelper,
        private mode: InteractiveWindowMode,
        private workspaceRoot: Resource,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly kernelProvider: IKernelProvider,
        private owner: Resource
    ) {}

    public updateMode(mode: InteractiveWindowMode) {
        this.mode = mode;
    }

    updateOwner(file: Uri) {
        if (!this.owner) {
            this.owner = file;
        }
    }

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

    public async startKernel(): Promise<IKernel> {
        if (this.kernel) {
            return this.kernel.promise;
        }
        if (!this.controller || !this.metadata) {
            throw new Error('Controller not selected');
        }

        this.setInfoMessageCell(this.metadata, SysInfoReason.Start);
        try {
            const kernel = await this.startKernelInternal();
            const kernelEventHookForRestart = async () => {
                if (this.notebook && this.metadata) {
                    this.systemInfoCell = undefined;
                    // If we're about to restart, insert a 'restarting' message as it happens
                    this.setInfoMessageCell(this.metadata, SysInfoReason.Restart);
                }
            };
            // Hook pre interrupt so we can stick in a message
            this.kernelDisposables.push(kernel.addHook('willRestart', kernelEventHookForRestart));
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
                this.kernelDisposables
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

    private async startKernelInternal(): Promise<IKernel> {
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
                this.calculateKernelFile(),
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

    private calculateKernelFile() {
        if (this.owner) {
            return this.owner;
        }
        if (this.workspaceRoot && this.notebook) {
            return Uri.joinPath(this.workspaceRoot, this.notebook.uri.path);
        }
        return undefined;
    }

    private async setFileInKernel(kernel: IKernel): Promise<void> {
        const file = this.calculateKernelFile();
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

    private setInfoMessageCell(metadata: KernelConnectionMetadata, reason: SysInfoReason) {
        if (!this.notebook) {
            return;
        }
        const message = getSysInfoMessage(metadata, reason);
        if (!this.systemInfoCell) {
            this.systemInfoCell = new SystemInfoCell(this.notebook, message);
        } else {
            this.systemInfoCell
                .updateMessage(message)
                .catch((error) => traceWarning(`could not update kernel ${reason} info message: ${error}`));
        }
    }

    private finishSysInfoMessage(kernel: IKernel, reason: SysInfoReason) {
        const displayName = getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata);
        const kernelInfo = 'info' in kernel && kernel.info?.status === 'ok' ? kernel.info : undefined;
        const banner = kernelInfo ? kernelInfo.banner.split('\n').join('  \n') : kernel.toString();
        const message = reason == SysInfoReason.Restart ? DataScience.restartedKernelHeader(displayName || '') : banner;
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
        private readonly workspaceRoot: Resource
    ) {}

    public create(errorHandler: IDataScienceErrorHandler, kernelProvider: IKernelProvider, owner: Resource) {
        return new InteractiveWindowController(
            this.controllerService,
            this.mode,
            this.workspaceRoot,
            errorHandler,
            kernelProvider,
            owner
        );
    }
}
