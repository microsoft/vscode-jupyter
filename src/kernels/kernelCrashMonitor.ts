// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { NotebookCell, window } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { Telemetry } from '../platform/common/constants';
import { IDisposableRegistry } from '../platform/common/types';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import { endCellAndDisplayErrorsInCell } from './execution/helpers';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernel, IKernelProvider } from './types';
import { swallowExceptions } from '../platform/common/utils/decorators';
import { notebookCellExecutions } from '../platform/notebooks/cellExecutionStateService';

/**
 * Monitors kernel crashes and on the event of a crash will display the results in the most recent cell.
 */
@injectable()
export class KernelCrashMonitor implements IExtensionSyncActivationService {
    private lastExecutedCellPerKernel = new WeakMap<IKernel, NotebookCell | undefined>();
    private kernelsStartedSuccessfully = new WeakSet<IKernel>();

    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider
    ) {}
    public activate(): void {
        this.kernelProvider.onKernelStatusChanged(this.onKernelStatusChanged, this, this.disposableRegistry);
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposableRegistry);
    }
    private onDidStartKernel(kernel: IKernel) {
        this.kernelsStartedSuccessfully.add(kernel);
        notebookCellExecutions.onDidChangeNotebookCellExecutionState((e) => {
            if (e.cell.notebook === kernel.notebook && this.kernelProvider.get(e.cell.notebook) === kernel) {
                this.lastExecutedCellPerKernel.set(kernel, e.cell);
            }
        });
    }

    @swallowExceptions()
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
            window
                .showErrorMessage(
                    DataScience.kernelDiedWithoutError(
                        getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
                    )
                )
                .then(noop, noop);

            await this.endCellAndDisplayErrorsInCell(kernel);
        }

        // If this kernel is still active & we're using Jupyter kernels,
        // and the session is auto restarting, then this means the kernel died.
        // notify the user of this
        if (kernel.session.kind !== 'localRaw' && kernel.status === 'autorestarting') {
            window
                .showErrorMessage(
                    DataScience.kernelDiedWithoutErrorAndAutoRestarting(
                        getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
                    )
                )
                .then(noop, noop);

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
            DataScience.kernelCrashedDueToCodeInCurrentOrPreviousCell,
            false
        );
    }
}
