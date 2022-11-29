// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { traceError, traceVerbose, traceWarning } from '../../../platform/logging';
import { IPythonExecutionFactory, ObservableExecutionResult } from '../../../platform/common/process/types.node';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { inject, injectable } from 'inversify';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IAsyncDisposable, IDisposableRegistry, IExtensionContext, Resource } from '../../../platform/common/types';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { Disposable, Uri } from 'vscode';
import { EOL } from 'os';
import { swallowExceptions } from '../../../platform/common/utils/misc';
function isBestPythonInterpreterForAnInterruptDaemon(interpreter: PythonEnvironment) {
    // Give preference to globally installed python environments.
    // The assumption is that users are more likely to uninstall/delete local python environments
    // than global ones.
    // The process started for interrupting kernels is per vs code session.
    // What we'd like to prevent is, a user creates a local python environment, and then we start an interrupt daemon
    // from that and then they subsequently delete that environment (on linux things should be fine, but on windows, users might not be able
    // to delete that environment folder as the files are in use).
    // At least this way user will  not have to exit vscode completely to delete such files/folders.
    if (
        isSupportedPythonVersion(interpreter) &&
        (interpreter?.envType === EnvironmentType.Unknown ||
            interpreter?.envType === EnvironmentType.Pyenv ||
            interpreter?.envType === EnvironmentType.Conda)
    ) {
        return true;
    }
    return false;
}
function isSupportedPythonVersion(interpreter: PythonEnvironment) {
    if (
        (interpreter?.version?.major ?? 3) >= 3 &&
        // Even thought 3.6 is no longer supported, we know this works well enough for what we want.
        // This way we don't need to update this every time the supported version changes.
        (interpreter?.version?.minor ?? 6) >= 6
    ) {
        return true;
    }
    return false;
}

type InterruptHandle = number;
type Command =
    | { command: 'INITIALIZE_INTERRUPT' }
    | { command: 'INTERRUPT'; handle: InterruptHandle }
    | { command: 'DISPOSE_INTERRUPT_HANDLE'; handle: InterruptHandle };
export type Interrupter = IAsyncDisposable & {
    handle: InterruptHandle;
    interrupt: () => Promise<void>;
};
/**
 * Special daemon (process) creator to handle allowing interrupt on windows.
 * On windows we need a separate process to handle an interrupt signal that we custom send from the extension.
 * Things like SIGTERM don't work on windows.
 */
@injectable()
export class PythonKernelInterruptDaemon {
    private startupPromise?: Promise<ObservableExecutionResult<string>>;
    private messages = new Map<number, Deferred<unknown>>();
    private requestCounter: number = 0;
    constructor(
        @inject(IPythonExecutionFactory) private readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}
    public async createInterrupter(pythonEnvironment: PythonEnvironment, resource: Resource): Promise<Interrupter> {
        try {
            return await this.createInterrupterImpl(pythonEnvironment, resource);
        } catch (ex) {
            traceError(`Failed to create interrupter, trying again`, ex);
            return this.createInterrupterImpl(pythonEnvironment, resource);
        }
    }
    private async createInterrupterImpl(
        pythonEnvironment: PythonEnvironment,
        resource: Resource
    ): Promise<Interrupter> {
        const interruptHandle = (await this.sendCommand(
            { command: 'INITIALIZE_INTERRUPT' },
            pythonEnvironment,
            resource
        )) as number;
        if (!interruptHandle) {
            traceError(`Unable to initialize interrupt handle`);
            throw new Error(`Unable to initialize interrupt handle`);
        }

        return {
            handle: interruptHandle,
            interrupt: async () => {
                await this.sendCommand({ command: 'INTERRUPT', handle: interruptHandle }, pythonEnvironment, resource);
            },
            dispose: async () => {
                await this.sendCommand(
                    { command: 'DISPOSE_INTERRUPT_HANDLE', handle: interruptHandle },
                    pythonEnvironment,
                    resource
                );
            }
        };
    }

    private async getInterpreter(interpreter: PythonEnvironment) {
        if (interpreter && isBestPythonInterpreterForAnInterruptDaemon(interpreter)) {
            return interpreter;
        }

        const interpreters = this.interpreters.resolvedEnvironments;
        if (interpreters.length === 0) {
            return interpreter;
        }
        return (
            interpreters.find(isBestPythonInterpreterForAnInterruptDaemon) ||
            interpreters.find(isSupportedPythonVersion) ||
            interpreter
        );
    }
    private async initializeInterrupter(pythonEnvironment: PythonEnvironment, resource: Resource) {
        if (this.startupPromise) {
            return this.startupPromise;
        }
        const promise = (async () => {
            const interpreter = await this.getInterpreter(pythonEnvironment);
            const executionService = await this.pythonExecutionFactory.createActivatedEnvironment({
                interpreter,
                resource
            });
            const dsFolder = Uri.joinPath(this.context.extensionUri, 'pythonFiles', 'vscode_datascience_helpers');
            const file = Uri.joinPath(dsFolder, 'kernel_interrupt_daemon.py');
            const proc = executionService.execObservable([file.fsPath, '--ppid', process.pid.toString()], {
                cwd: dsFolder.fsPath
            });

            const subscription = proc.out.subscribe((out) => {
                if (out.source === 'stdout' && out.out.includes('INTERRUPT:')) {
                    out.out
                        .splitLines({ trim: true, removeEmptyEntries: true })
                        .filter((output) => output.includes('INTERRUPT:'))
                        .forEach((output) => {
                            try {
                                const [command, id, response] = output.split(':');
                                const deferred = this.messages.get(parseInt(id, 10));
                                if (deferred) {
                                    traceVerbose(`Got a response of ${response} for ${command}:${id}`);
                                    deferred.resolve(response);
                                } else {
                                    traceError(
                                        `Got a response of ${response} for ${command}:${id} but no command entry found in ${out.out}`
                                    );
                                }
                            } catch (ex) {
                                traceError(`Failed to parse interrupt daemon response, ${out.out}`, ex);
                            }
                        });
                } else {
                    traceWarning(`Error output in interrupt daemon response ${out.out}`);
                }
            });
            this.disposableRegistry.push(new Disposable(() => subscription.unsubscribe()));
            this.disposableRegistry.push(new Disposable(() => swallowExceptions(() => proc.proc?.kill())));
            return proc;
        })();
        promise.catch((ex) => traceError(`Failed to start interrupt daemon for (${pythonEnvironment.id})`, ex));
        this.startupPromise = promise;
        return promise;
    }
    private async sendCommand(
        command: Command,
        pythonEnvironment: PythonEnvironment,
        resource: Resource
    ): Promise<unknown> {
        const deferred = createDeferred<unknown>();
        const id = this.requestCounter++;
        this.messages.set(id, deferred);
        const messageToSend =
            command.command === 'INITIALIZE_INTERRUPT'
                ? `${command.command}:${id}`
                : `${command.command}:${id}:${command.handle}`;
        const { proc } = await this.initializeInterrupter(pythonEnvironment, resource);
        if (!proc || !proc.stdin) {
            // An impossible scenario, but types in node.js requires this, and we need to check to keep the compiler happy
            traceError('No process or stdin');
            throw new Error('No process or stdin');
        }
        proc.stdin.write(`${messageToSend}${EOL}`);
        const response = await deferred.promise;
        if (command.command === 'INITIALIZE_INTERRUPT') {
            return parseInt(response as string, 10);
        }
        return;
    }
}
