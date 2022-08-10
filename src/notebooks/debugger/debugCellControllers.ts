// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DebugProtocolMessage, NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ICommandManager } from '../../platform/common/application/types';
import { IKernel } from '../../kernels/types';
import { sendTelemetryEvent } from '../../telemetry';
import { DebuggingTelemetry } from './constants';
import { cellDebugSetup } from './helper';
import { IDebuggingDelegate, IKernelDebugAdapter } from './debuggingTypes';
import { noop } from '../../platform/common/utils/misc';

/**
 * Controls starting execution on a cell when debugging a cell.
 */
export class DebugCellController implements IDebuggingDelegate {
    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly kernel: IKernel,
        private readonly commandManager: ICommandManager
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    public async willSendEvent(_msg: DebugProtocolMessage): Promise<boolean> {
        return false;
    }

    public async willSendRequest(request: DebugProtocol.Request): Promise<void> {
        if (request.command === 'configurationDone') {
            await cellDebugSetup(this.kernel, this.debugAdapter);

            this.commandManager
                .executeCommand('notebook.cell.execute', {
                    ranges: [{ start: this.debugCell.index, end: this.debugCell.index + 1 }],
                    document: this.debugCell.document.uri
                })
                .then(noop, noop);
        }
    }
}
