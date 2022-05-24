// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// import * as path from '../../../platform/vscode-path/path';
import { DebugProtocolMessage, NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebuggingDelegate, IKernelDebugAdapter } from '../../../kernels/debugger/types';
import { DebuggingTelemetry } from '../../../kernels/debugger/constants';
import { IKernel } from '../../../kernels/types';
import { cellDebugSetup } from '../../../notebooks/debugger/helper';
import { createDeferred } from '../../../platform/common/utils/async';
import { sendTelemetryEvent } from '../../../telemetry';
import { getInteractiveCellMetadata } from '../../helpers';

export class DebugCellController implements IDebuggingDelegate {
    private readonly _ready = createDeferred<void>();
    public readonly ready = this._ready.promise;
    private cellDumpInvoked?: boolean;
    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly kernel: IKernel
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    public async willSendEvent(_msg: DebugProtocolMessage): Promise<boolean> {
        return false;
    }
    public async willSendRequest(request: DebugProtocol.Request): Promise<void> {
        const metadata = getInteractiveCellMetadata(this.debugCell);
        if (request.command === 'setBreakpoints' && metadata && metadata.generatedCode && !this.cellDumpInvoked) {
            this.cellDumpInvoked = true;
            await cellDebugSetup(this.kernel, this.debugAdapter);
        }
        if (request.command === 'configurationDone' && metadata && metadata.generatedCode) {
            if (!this.cellDumpInvoked) {
                this.cellDumpInvoked = true;
                await cellDebugSetup(this.kernel, this.debugAdapter);
            }
            this._ready.resolve();
        }
    }
}
