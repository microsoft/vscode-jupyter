// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import { MessageConnection, RequestType0 } from 'vscode-jsonrpc';
import { traceInfo } from '../../../client/common/logger';
import { IPlatformService } from '../../../client/common/platform/types';
import { BasePythonDaemon } from '../../../client/common/process/baseDaemon';
import { IPythonExecutionService } from '../../../client/common/process/types';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { IPythonKernelDaemon } from '../types';

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
