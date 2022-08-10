// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DebugProtocolMessage, NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebuggingDelegate, IKernelDebugAdapter } from '../../../notebooks/debugger/debuggingTypes';
import { DebuggingTelemetry } from '../../../notebooks/debugger/constants';
import { IKernel } from '../../../kernels/types';
import { cellDebugSetup } from '../../../notebooks/debugger/helper';
import { createDeferred } from '../../../platform/common/utils/async';
import { sendTelemetryEvent } from '../../../telemetry';
import { getInteractiveCellMetadata } from '../../helpers';

/**
 * Class that handles keeping track of whether or not a cell needs to be dumped before debugging.
 * Dumping a cell is how the IPython kernel determines the file path of a cell
 */
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
    private debugCellDumped?: Promise<void>;
    public async willSendRequest(request: DebugProtocol.Request): Promise<void> {
        const metadata = getInteractiveCellMetadata(this.debugCell);
        if (request.command === 'setBreakpoints' && metadata && metadata.generatedCode && !this.cellDumpInvoked) {
            if (!this.debugCellDumped) {
                this.debugCellDumped = cellDebugSetup(this.kernel, this.debugAdapter);
            }
            await this.debugCellDumped;
        }
        if (request.command === 'configurationDone' && metadata && metadata.generatedCode) {
            if (!this.debugCellDumped) {
                this.debugCellDumped = cellDebugSetup(this.kernel, this.debugAdapter);
            }
            await this.debugCellDumped;
            this._ready.resolve();
        }
    }
}
