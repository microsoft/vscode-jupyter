// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import { Subject } from 'rxjs/Subject';
import { MessageConnection, NotificationType, RequestType, RequestType0 } from 'vscode-jsonrpc';
import { traceInfo, traceWarning } from '../../common/logger';
import { IPlatformService } from '../../common/platform/types';
import { BasePythonDaemon, ExecResponse } from '../../common/process/baseDaemon';
import { IPythonExecutionService, ObservableExecutionResult, Output, SpawnOptions } from '../../common/process/types';
import { IPythonKernelDaemon, PythonKernelDiedError } from './types';

export class PythonKernelDaemon extends BasePythonDaemon implements IPythonKernelDaemon {
    private started?: boolean;
    private killed?: boolean;
    private preWarmed?: boolean;
    private outputHooked?: boolean;
    private readonly subject = new Subject<Output<string>>();
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(
        pythonExecutionService: IPythonExecutionService,
        platformService: IPlatformService,
        pythonPath: string,
        proc: ChildProcess,
        connection: MessageConnection
    ) {
        super(pythonExecutionService, platformService, pythonPath, proc, connection);
    }
    public async interrupt() {
        const request = new RequestType0<void, void, void>('interrupt_kernel');
        await this.sendRequestWithoutArgs(request);
    }
    public async kill() {
        traceInfo('kill daemon');
        if (this.killed) {
            return;
        }
        this.killed = true;
        const request = new RequestType0<void, void, void>('kill_kernel');
        await this.sendRequestWithoutArgs(request);
    }
    public async preWarm() {
        if (this.started) {
            return;
        }
        this.preWarmed = true;
        this.monitorOutput();
        const request = new RequestType0<void, void, void>('prewarm_kernel');

        await this.sendRequestWithoutArgs(request);
    }

    public async start(
        moduleName: string,
        args: string[],
        options: SpawnOptions
    ): Promise<ObservableExecutionResult<string>> {
        if (this.killed) {
            throw new Error('Restarting a dead daemon');
        }
        if (options.throwOnStdErr) {
            throw new Error("'throwOnStdErr' not supported in spawnOptions for KernelDaemon.start");
        }
        if (options.mergeStdOutErr) {
            throw new Error("'mergeStdOutErr' not supported in spawnOptions for KernelDaemon.start");
        }
        if (this.started) {
            throw new Error('Kernel has already been started in daemon');
        }
        this.started = true;
        this.monitorOutput();

        if (this.preWarmed) {
            const request = new RequestType<{ args: string[] }, ExecResponse, void, void>('start_prewarmed_kernel');
            await this.sendRequest(request, { args: [moduleName].concat(args) });
        } else {
            // No need of the output here, we'll tap into the output coming from daemon `this.outputObservale`.
            // This is required because execModule will never end.
            // We cannot use `execModuleObservable` as that only works where the daemon is busy seeerving on request and we wait for it to finish.
            // In this case we're never going to wait for the module to run to end. Cuz when we run `pytohn -m ipykernel`, it never ends.
            // It only ends when the kernel dies, meaning the kernel process is dead.
            // What we need is to be able to run the module and keep getting a stream of stdout/stderr.
            // & also be able to execute other python code. I.e. we need a daemon.
            // For this we run the `ipykernel` code in a separate thread.
            // This is why when we run `execModule` in the Kernel daemon, it finishes (comes back) quickly.
            // However in reality it is running in the background.
            // See `m_exec_module_observable` in `kernel_launcher_daemon.py`.
            await this.execModule(moduleName, args, options);
        }

        return {
            proc: this.proc,
            dispose: () => this.dispose(),
            out: this.subject
        };
    }
    private monitorOutput() {
        if (this.outputHooked) {
            return;
        }
        this.outputHooked = true;
        // Message from daemon when kernel dies.
        const KernelDiedNotification = new NotificationType<{ exit_code: string; reason?: string }, void>(
            'kernel_died'
        );
        let stdErr = '';
        this.connection.onNotification(KernelDiedNotification, (output) => {
            this.subject.error(
                new PythonKernelDiedError({
                    exitCode: parseInt(output.exit_code, 10),
                    reason: output.reason || stdErr, // If we have collected the error then use that (if reason is empty).
                    stdErr: stdErr || output.reason || ''
                })
            );
        });

        // All output messages from daemon from here on are considered to be coming from the kernel.
        // This is because the kernel is a long running process and that will be the only code in the daemon
        // spitting stuff into stdout/stderr.
        this.outputObservable.subscribe(
            (out) => {
                if (out.source === 'stderr') {
                    // Don't call this.subject.error, as that can only be called once (hence can only be handled once).
                    // Instead log this error & pass this only when the kernel dies.
                    stdErr += out.out;
                    traceWarning(`Kernel ${this.proc.pid} as possibly died, StdErr from Kernel Process ${out.out}`);
                } else {
                    this.subject.next(out);
                }
            },
            this.subject.error.bind(this.subject),
            this.subject.complete.bind(this.subject)
        );

        // If the daemon dies, then kernel is also dead.
        this.closed.catch((error) => this.subject.error(new PythonKernelDiedError({ error, stdErr })));
    }
}
