// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IServiceContainer } from '../../../platform/ioc/types';
import { traceError, traceVerbose } from '../../../platform/logging';
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
        this.debuggingManager = this.serviceContainer.get<INotebookDebuggingManager>(INotebookDebuggingManager);
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-Restart] ${tag}: ${msg}`);
    }

    private error(tag: string, msg: string) {
        traceError(`[Debug-Restart] ${tag}: ${msg}`);
    }

    public async willSendResponse(response: DebugProtocol.Response): Promise<void> {
        if (response.command === 'initialize' && response.body) {
            (response as DebugProtocol.InitializeResponse).body!.supportsRestartRequest = true;
        }
    }

    public async willSendRequest(request: DebugProtocol.Request): Promise<undefined | DebugProtocol.Response> {
        if (request.command === 'restart') {
            // We have to implement restart manually because the previous launch config includes the cell index, but the cell index may have changed.
            this.trace('restart', 'Handling restart request');
            setTimeout(() => {
                // The restart response has to be sent _before_ the debug session is disconnected - otherwise the pending restart request will be canceled,
                // and considered to have failed. eg a call to executeCommand('workbench.action.debug.restart') would fail.
                this.debugAdapter
                    .disconnect()
                    .then(() => {
                        this.trace('restart', 'doRestart');
                        return this.debuggingManager.tryToStartDebugging(this.mode, this.debugCell, true);
                    })
                    .catch((err) => {
                        this.error('restart', `Error restarting: ${err}`);
                    });
            }, 0);
            return {
                command: request.command,
                request_seq: request.seq,
                seq: request.seq,
                success: true,
                type: 'response'
            };
        }

        return undefined;
    }
}
