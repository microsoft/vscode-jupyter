// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { IJupyterServerUriStorage } from '../types';
import { IKernel, IKernelProvider, isRemoteConnection } from '../../types';
import {
    notebookCellExecutions,
    type NotebookCellExecutionStateChangeEvent
} from '../../../platform/notebooks/cellExecutionStateService';
import { Delayer } from '../../../platform/common/utils/async';

const INTERVAL_IN_SECONDS_TO_UPDATE_MRU = 1_000;
@injectable()
export class RemoteJupyterServerMruUpdate implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly timeouts = new Set<Disposable>();
    private readonly kernelSpecificUpdates = new WeakMap<IKernel, Delayer<void>>();
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
    }
    dispose() {
        dispose(this.disposables);
        dispose(Array.from(this.timeouts.values()));
    }
    activate(): void {
        this.disposables.push(
            notebookCellExecutions.onDidChangeNotebookCellExecutionState(
                this.onDidChangeNotebookCellExecutionState,
                this
            )
        );
    }
    private onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent) {
        const kernel = this.kernelProvider.get(e.cell.notebook);
        if (!kernel) {
            return;
        }
        const connection = kernel.kernelConnectionMetadata;
        if (!isRemoteConnection(connection)) {
            return;
        }
        const delayer = this.kernelSpecificUpdates.get(kernel) || new Delayer(INTERVAL_IN_SECONDS_TO_UPDATE_MRU);
        this.kernelSpecificUpdates.set(kernel, delayer);

        // We do not want 100s of 1000s of these timeouts,
        // multiply by notebooks, and multiply by number of kernels, this grows unnecessarily.
        void delayer.trigger(() => {
            // Log this remote URI into our MRU list
            if (kernel.disposed || kernel.disposing) {
                return;
            }
            // Log this remote URI into our MRU list
            this.serverStorage.update(connection.serverProviderHandle).catch(noop);
        });
    }
}
