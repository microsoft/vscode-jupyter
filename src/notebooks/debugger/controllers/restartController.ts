// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { noop } from '../../../platform/common/utils/misc';
import { IServiceContainer } from '../../../platform/ioc/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { DebuggingTelemetry } from '../constants';
import { IDebuggingDelegate, IKernelDebugAdapter, INotebookDebuggingManager, KernelDebugMode } from '../debuggingTypes';

/**
 * Implements the "restart" request.
 */
export class RestartController implements IDebuggingDelegate {
    private debuggingManager: INotebookDebuggingManager;

    constructor(
        private readonly mode: KernelDebugMode,
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly serviceContainer: IServiceContainer
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunByLine);
        this.debuggingManager = this.serviceContainer.get<INotebookDebuggingManager>(INotebookDebuggingManager);
    }

    public async willSendRequest(request: DebugProtocol.Request): Promise<boolean> {
        if (request.command === 'restart') {
            await this.debugAdapter.disconnect();
            this.doRestart().then(noop, noop);
            return true;
        }

        return false;
    }

    public async willSendResponse(response: DebugProtocol.Response): Promise<void> {
        if (response.command === 'initialize' && response.body) {
            (response as DebugProtocol.InitializeResponse).body!.supportsRestartRequest = true;
        }
    }

    private async doRestart() {
        // We have to implement restart manually because the previous launch config includes the cell index, but the cell index may have changed.
        return this.debuggingManager.tryToStartDebugging(this.mode, this.debugCell);
    }
}
