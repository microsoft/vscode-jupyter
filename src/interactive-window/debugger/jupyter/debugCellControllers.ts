// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from '../../../platform/vscode-path/path';
import { DebugProtocolMessage, NotebookCell, Uri } from 'vscode';
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
        if (request.command === 'configurationDone' && metadata && metadata.generatedCode) {
            await cellDebugSetup(this.kernel, this.debugAdapter);

            const realPath = this.debugAdapter.getSourceMap(metadata.interactive.uristring);
            if (realPath) {
                const initialBreakpoint: DebugProtocol.SourceBreakpoint = {
                    line: metadata.generatedCode.firstExecutableLineIndex - metadata.interactive.line
                };
                const uri = Uri.parse(metadata.interactive.uristring);
                await this.debugAdapter.setBreakpoints({
                    source: {
                        name: path.basename(uri.path),
                        path: realPath.path
                    },
                    breakpoints: [initialBreakpoint],
                    sourceModified: false
                });
            }
            this._ready.resolve();
        }
    }
}
