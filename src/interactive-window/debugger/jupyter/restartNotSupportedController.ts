// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebuggingDelegate } from '../../../notebooks/debugger/debuggingTypes';
import { IApplicationShell } from '../../../platform/common/application/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { IServiceContainer } from '../../../platform/ioc/types';
import { traceVerbose } from '../../../platform/logging';

/**
 * Implements the "restart" request.
 */
export class RestartNotSupportedController implements IDebuggingDelegate {
    private readonly applicationShell: IApplicationShell;

    constructor(public readonly debugCell: NotebookCell, serviceContainer: IServiceContainer) {
        this.applicationShell = serviceContainer.get<IApplicationShell>(IApplicationShell);
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-IWRestart] ${tag}: ${msg}`);
    }

    public async willSendResponse(response: DebugProtocol.Response): Promise<void> {
        if (response.command === 'initialize' && response.body) {
            (response as DebugProtocol.InitializeResponse).body!.supportsRestartRequest = true;
        }
    }

    public async willSendRequest(request: DebugProtocol.Request): Promise<undefined | DebugProtocol.Response> {
        if (request.command === 'restart') {
            this.trace('restart', 'Showing warning for unsupported restart request');
            this.applicationShell.showWarningMessage(DataScience.restartNotSupported, { modal: true }).then(noop, noop);
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
