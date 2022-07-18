// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import { MessageConnection, RequestType0 } from 'vscode-jsonrpc';
import { traceInfo } from '../../../platform/logging';
import { IPlatformService } from '../../../platform/common/platform/types';
import { BasePythonDaemon } from '../../../platform/common/process/baseDaemon.node';
import { IPythonExecutionService } from '../../../platform/common/process/types.node';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IPythonKernelDaemon } from '../types';

/**
 * Special daemon (process) creator to handle allowing interrupt on windows.
 * On windows we need a separate process to handle an interrupt signal that we custom send from the extension.
 * Things like SIGTERM don't work on windows.
 */
export class PythonKernelInterruptDaemon extends BasePythonDaemon implements IPythonKernelDaemon {
    private killed?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(
        pythonExecutionService: IPythonExecutionService,
        platformService: IPlatformService,
        interpreter: PythonEnvironment,
        proc: ChildProcess,
        connection: MessageConnection
    ) {
        super(pythonExecutionService, platformService, interpreter, proc, connection);
    }
    public async interrupt() {
        const request = new RequestType0<void, void>('interrupt_kernel');
        await this.sendRequestWithoutArgs(request);
    }
    public async kill() {
        traceInfo('kill daemon');
        if (this.killed) {
            return;
        }
        this.killed = true;
        const request = new RequestType0<void, void>('kill_kernel');
        await this.sendRequestWithoutArgs(request);
    }

    public async getInterruptHandle() {
        traceInfo('get interrupthandle daemon');
        const request = new RequestType0<number, void>('get_handle');

        const response = await this.sendRequestWithoutArgs(request);
        return response;
    }
}
