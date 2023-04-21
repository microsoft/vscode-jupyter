// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { INotebookKernelExecution } from '../../../kernels/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { noop } from '../../../platform/common/utils/misc';
import { traceVerbose } from '../../../platform/logging';
import { sendTelemetryEvent } from '../../../telemetry';
import { DebuggingTelemetry } from '../constants';
import { IDebuggingDelegate, IKernelDebugAdapter } from '../debuggingTypes';
import { cellDebugSetup } from '../helper';

export function isJustMyCodeNotification(msg: string): boolean {
    return msg.includes('Frame skipped from debugging during step-in');
}

export function isDebugpyAttachRequest(msg: DebugProtocol.Event): boolean {
    return msg.event === 'debugpyAttach';
}

/**
 * Controls starting execution on a cell when debugging a cell.
 */
export class DebugCellController implements IDebuggingDelegate {
    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly execution: INotebookKernelExecution,
        private readonly commandManager: ICommandManager
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-Cell] ${tag}: ${msg}`);
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

    public async willSendRequest(request: DebugProtocol.Request): Promise<undefined> {
        if (request.command === 'configurationDone') {
            await cellDebugSetup(this.execution, this.debugAdapter);

            this.commandManager
                .executeCommand('notebook.cell.execute', {
                    ranges: [{ start: this.debugCell.index, end: this.debugCell.index + 1 }],
                    document: this.debugCell.notebook.uri
                })
                .then(noop, noop);
        }

        return undefined;
    }
}
