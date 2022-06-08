// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { NotebookCell } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IApplicationShell } from '../platform/common/application/types';
import { Telemetry } from '../platform/common/constants';
import { IDisposableRegistry } from '../platform/common/types';
import { DataScience } from '../platform/common/utils/localize';
import { sendKernelTelemetryEvent } from '../telemetry/telemetry';
import { endCellAndDisplayErrorsInCell } from './execution/helpers';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernel, IKernelProvider } from './types';

@injectable()
export class KernelCrashMonitor implements IExtensionSyncActivationService {
    private lastExecutedCellPerKernel = new WeakMap<IKernel, NotebookCell | undefined>();
    private kernelsStartedSuccessfully = new WeakSet<IKernel>();

    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider
    ) {}
    public activate(): void {
        this.kernelProvider.onKernelStatusChanged(this.onKernelStatusChanged, this, this.disposableRegistry);
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposableRegistry);
    }
    private onDidStartKernel(kernel: IKernel) {
        this.kernelsStartedSuccessfully.add(kernel);
        kernel.onPreExecute((cell) => this.lastExecutedCellPerKernel.set(kernel, cell), this, this.disposableRegistry);
    }

    private async onKernelStatusChanged({ kernel }: { status: KernelMessage.Status; kernel: IKernel }) {
        // We're only interested in kernels that started successfully.
        if (!this.kernelsStartedSuccessfully.has(kernel)) {
            return;
        }
        if (kernel.disposed || kernel.disposing || !kernel.session) {
            return;
        }

        // If this kernel is still active & we're using raw kernels,
        // and the session has died, then notify the user of this dead kernel.
        // Note: We know this kernel started successfully.
        if (kernel.session.kind === 'localRaw' && kernel.status === 'dead') {
            void this.applicationShell.showErrorMessage(
                DataScience.kernelDiedWithoutError().format(
                    getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
                )
            );

            await this.endCellAndDisplayErrorsInCell(kernel);
        }

        // If this kernel is still active & we're using Jupyter kernels,
        // and the session is auto restarting, then this means the kernel died.
        // notify the user of this
        if (kernel.session.kind !== 'localRaw' && kernel.status === 'autorestarting') {
            void this.applicationShell.showErrorMessage(
                DataScience.kernelDiedWithoutErrorAndAutoRestarting().format(
                    getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
                )
            );

            await this.endCellAndDisplayErrorsInCell(kernel);
        }
    }
    private async endCellAndDisplayErrorsInCell(kernel: IKernel) {
        const lastExecutedCell = this.lastExecutedCellPerKernel.get(kernel);
        sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.KernelCrash);
        if (!lastExecutedCell) {
            return;
        }
        return endCellAndDisplayErrorsInCell(
            lastExecutedCell,
            kernel.controller,
            DataScience.kernelCrashedDueToCodeInCurrentOrPreviousCell(),
            false
        );
    }
}
