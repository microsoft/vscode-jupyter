// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IKernel } from '../../../kernels/types';
import { DebuggingTelemetry } from '../../../notebooks/debugger/constants';
import { isJustMyCodeNotification } from '../../../notebooks/debugger/controllers/debugCellController';
import { IDebuggingDelegate, IKernelDebugAdapter } from '../../../notebooks/debugger/debuggingTypes';
import { cellDebugSetup } from '../../../notebooks/debugger/helper';
import { traceVerbose } from '../../../platform/logging';
import { sendTelemetryEvent } from '../../../telemetry';
import { getInteractiveCellMetadata } from '../../helpers';

/**
 * Class that handles keeping track of whether or not a cell needs to be dumped before debugging.
 * Dumping a cell is how the IPython kernel determines the file path of a cell
 */
export class DebugCellController implements IDebuggingDelegate {
    private cellDumpInvoked?: boolean;
    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly kernel: IKernel
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-IW] ${tag}: ${msg}`);
    }

    public async willSendEvent(msg: DebugProtocol.Event): Promise<boolean> {
        if (msg.event === 'output') {
            if (isJustMyCodeNotification(msg.body.output)) {
                this.trace('intercept', 'justMyCode notification');
                return true;
            }
        }

        return false;
    }

    private debugCellDumped?: Promise<void>;
    public async willSendRequest(request: DebugProtocol.Request): Promise<boolean> {
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
        }

        return false;
    }
}
