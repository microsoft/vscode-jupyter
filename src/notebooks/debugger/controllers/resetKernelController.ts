// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DebugProtocol } from 'vscode-debugprotocol';
import { traceVerbose } from '../../../platform/logging';
import { IDebuggingDelegate, IKernelDebugAdapter } from '../debuggingTypes';

/**
 * Reset the kernel state when attaching
 */
export class ResetKernelController implements IDebuggingDelegate {
    constructor(private readonly debugAdapter: IKernelDebugAdapter) {}

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-Reset] ${tag}: ${msg}`);
    }

    public async willSendRequest(request: DebugProtocol.Request): Promise<undefined | DebugProtocol.Response> {
        // before attaching, send a 'debugInfo' request
        // reset breakpoints and continue stopped threads if there are any
        // we do this in case the kernel is stopped when we attach
        // This might happen if VS Code or the extension host crashes
        if (request.command === 'attach') {
            this.trace('attach', 'Continuing paused kernel threads if needed');
            const info = await this.debugAdapter.debugInfo();

            // If there's stopped threads at this point, continue them all
            info.stoppedThreads.forEach((threadId) => this.debugAdapter.continueDirect(threadId));
        }

        return undefined;
    }
}
