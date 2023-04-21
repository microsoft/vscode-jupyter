// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { INotebookKernelExecution } from '../../../kernels/types';
import { DebuggingTelemetry } from '../../../notebooks/debugger/constants';
import {
    isDebugpyAttachRequest,
    isJustMyCodeNotification
} from '../../../notebooks/debugger/controllers/debugCellController';
import { IDebuggingDelegate, IKernelDebugAdapter } from '../../../notebooks/debugger/debuggingTypes';
import { cellDebugSetup } from '../../../notebooks/debugger/helper';
import { createDeferred } from '../../../platform/common/utils/async';
import { traceVerbose } from '../../../platform/logging';
import { sendTelemetryEvent } from '../../../telemetry';
import { getInteractiveCellMetadata } from '../../helpers';

/**
 * Class that handles keeping track of whether or not a cell needs to be dumped before debugging.
 * Dumping a cell is how the IPython kernel determines the file path of a cell
 */
export class DebugCellController implements IDebuggingDelegate {
    private _ready = createDeferred();
    public readonly ready = this._ready.promise;

    private cellDumpInvoked?: boolean;
    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly execution: INotebookKernelExecution
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-IW] ${tag}: ${msg}`);
    }

    public async willSendEvent(msg: DebugProtocol.Event): Promise<boolean> {
        if (isDebugpyAttachRequest(msg)) {
            this.trace('intercept', 'debugpyAttach request for subprocess, not supported');
            return true;
        }

        if (msg.event === 'output') {
            if (isJustMyCodeNotification(msg.body.output)) {
                this.trace('intercept', 'justMyCode notification');
                return true;
            }
        }

        return false;
    }

    private debugCellDumped?: Promise<void>;
    public async willSendRequest(request: DebugProtocol.Request): Promise<undefined | DebugProtocol.Response> {
        const metadata = getInteractiveCellMetadata(this.debugCell);
        if (request.command === 'setBreakpoints' && metadata && metadata.generatedCode && !this.cellDumpInvoked) {
            if (!this.debugCellDumped) {
                this.debugCellDumped = cellDebugSetup(this.execution, this.debugAdapter);
            }
            await this.debugCellDumped;
        }
        if (request.command === 'configurationDone' && metadata && metadata.generatedCode) {
            if (!this.debugCellDumped) {
                this.debugCellDumped = cellDebugSetup(this.execution, this.debugAdapter);
            }
            await this.debugCellDumped;
            this._ready.resolve();
        }

        return undefined;
    }
}
