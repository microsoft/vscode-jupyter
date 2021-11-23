// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable, named } from 'inversify';

import { IWorkspaceService } from '../../common/application/types';
import { IPlatformService } from '../../common/platform/types';
import * as internalScripts from '../../common/process/internal/scripts';
import { ExecutionResult, IProcessServiceFactory } from '../../common/process/types';
import { GLOBAL_MEMENTO, IDisposable, IMemento, Resource } from '../../common/types';
import { createDeferredFromPromise, sleep } from '../../common/utils/async';
import { OSType } from '../../common/utils/platform';
import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { logValue, TraceOptions } from '../../logging/trace';
import { getInterpreterHash } from '../../pythonEnvironments/info/interpreter';
import { IPythonApiProvider } from '../../api/types';
import { StopWatch } from '../utils/stopWatch';
import { Telemetry } from '../../datascience/constants';
import { Memento } from 'vscode';
import { getDisplayPath } from '../platform/fs-paths';
import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { CurrentProcess } from './currentProcess';
import { traceDecorators, traceError, traceInfo, traceVerbose, traceWarning } from '../logger';

const ENVIRONMENT_PREFIX = 'e8b39361-0157-4923-80e1-22d70d46dee6';
const ENVIRONMENT_TIMEOUT = 30000;
const CONDA_ENVIRONMENT_TIMEOUT = 60_000;

export enum TerminalShellType {
    commandPrompt = 'commandPrompt',
    bash = 'bash'
}

// The shell under which we'll execute activation scripts.
export const defaultShells = {
    [OSType.Windows]: { shell: 'cmd', shellType: TerminalShellType.commandPrompt },
    [OSType.OSX]: { shell: 'bash', shellType: TerminalShellType.bash },
    [OSType.Linux]: { shell: 'bash', shellType: TerminalShellType.bash },
    [OSType.Unknown]: undefined
};
export const PYTHON_WARNINGS = 'PYTHONWARNINGS';

const condaRetryMessages = [
    'The process cannot access the file because it is being used by another process',
    'The directory is not empty'
];

const ENVIRONMENT_ACTIVATION_COMMAND_CACHE_KEY_PREFIX = 'ENVIRONMENT_ACTIVATION_COMMAND_CACHE_KEY_PREFIX_{0}';

@injectable()
export class EnvironmentActivationService implements IEnvironmentActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly activatedEnvVariablesCache = new Map<string, Promise<NodeJS.ProcessEnv | undefined>>();
    private readonly envActivationCommands = new Map<string, Promise<string[] | undefined>>();
    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IProcessServiceFactory) private processServiceFactory: IProcessServiceFactory,
        @inject(CurrentProcess) private currentProcess: CurrentProcess,
        @inject(IWorkspaceService) private workspace: IWorkspaceService,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsService: IEnvironmentVariablesProvider,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento
    ) {
        this.envVarsService.onDidEnvironmentVariablesChange(
            () => this.activatedEnvVariablesCache.clear(),
            this,
            this.disposables
        );

        this.interpreterService.onDidChangeInterpreter(
            () => this.activatedEnvVariablesCache.clear(),
            this,
            this.disposables
        );
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
    @traceDecorators.verbose('Getting activated env variables', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async getActivatedEnvironmentVariables(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter?: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const stopWatch = new StopWatch();
        const envVariablesOurSelves = createDeferredFromPromise(
            this.getActivatedEnvironmentVariablesOurselves(resource, interpreter)
        );
        const envVariablesFromPython = createDeferredFromPromise(
            this.getActivatedEnvironmentVariablesFromPython(resource, interpreter)
        );

        await Promise.race([envVariablesOurSelves.promise, envVariablesFromPython.promise]);
        void envVariablesFromPython.promise.then(() =>
            traceVerbose(`Got env vars with python ${getDisplayPath(interpreter?.path)} in ${stopWatch.elapsedTime}ms`)
        );
        void envVariablesOurSelves.promise.then(() =>
            traceVerbose(`Got env vars ourselves ${getDisplayPath(interpreter?.path)} in ${stopWatch.elapsedTime}ms`)
        );
        // If we got this using our way, and we have env variables use it.
        if (envVariablesOurSelves.resolved) {
            if (envVariablesOurSelves.value) {
                traceVerbose(`Got env vars ourselves faster ${getDisplayPath(interpreter?.path)}`);
                return envVariablesOurSelves.value;
            } else {
                traceVerbose(`Got env vars ourselves faster, but empty ${getDisplayPath(interpreter?.path)}`);
            }
        }
        if (!envVariablesOurSelves.resolved) {
            traceVerbose(`Got env vars with python ext faster ${getDisplayPath(interpreter?.path)}`);
        }
        return envVariablesFromPython.promise;
    }
    @traceDecorators.verbose(
        'Getting activated env variables from Python',
        TraceOptions.BeforeCall | TraceOptions.Arguments
    )
    private async getActivatedEnvironmentVariablesFromPython(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter?: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const stopWatch = new StopWatch();
        const env = await this.apiProvider
            .getApi()
            .then((api) => api.getActivatedEnvironmentVariables(resource, interpreter, false));

        const envType = interpreter?.envType;
        sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
            envType,
            failed: Object.keys(env || {}).length === 0
        });
        // We must get actiavted env variables for Conda env, if not running stuff against conda will not work.
        // Hence we must log these as errors (so we can see them in jupyter logs).
        if (!env && envType === EnvironmentType.Conda) {
            traceError(`Failed to get activated conda env variables for ${getDisplayPath(interpreter?.path)}`);
        }
        return env;
    }
    @traceDecorators.verbose(
        'Getting activated env variables ourselves',
        TraceOptions.BeforeCall | TraceOptions.Arguments
    )
    private async getActivatedEnvironmentVariablesOurselves(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter?: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        const key = `${workspaceKey}_${interpreter && getInterpreterHash(interpreter)}`;
        const shellInfo = defaultShells[this.platform.osType];
        if (!shellInfo) {
            return;
        }

        if (this.activatedEnvVariablesCache.has(key)) {
            return this.activatedEnvVariablesCache.get(key);
        }

        const promise = (async () => {
            try {
                let isPossiblyCondaEnv = false;
                const [activationCommands, processService] = await Promise.all([
                    this.getActivationCommands(resource, interpreter),
                    this.processServiceFactory.create(resource)
                ]);
                if (!activationCommands || activationCommands.length === 0) {
                    return;
                }
                traceVerbose(`Activation Commands received ${activationCommands} for shell ${shellInfo.shell}`);
                isPossiblyCondaEnv = activationCommands.join(' ').toLowerCase().includes('conda');
                // Run the activate command collect the environment from it.
                const activationCommand = this.fixActivationCommands(activationCommands).join(' && ');
                const customEnvVars = await this.envVarsService.getEnvironmentVariables(resource);
                const hasCustomEnvVars = Object.keys(customEnvVars).length;
                const env = hasCustomEnvVars ? customEnvVars : { ...this.currentProcess.env };

                // Make sure python warnings don't interfere with getting the environment. However
                // respect the warning in the returned values
                const oldWarnings = env[PYTHON_WARNINGS];
                env[PYTHON_WARNINGS] = 'ignore';

                traceVerbose(`${hasCustomEnvVars ? 'Has' : 'No'} Custom Env Vars`);

                // In order to make sure we know where the environment output is,
                // put in a dummy echo we can look for
                const [args, parse] = internalScripts.printEnvVariables();
                args.forEach((arg, i) => {
                    args[i] = arg.toCommandArgument();
                });
                const command = `${activationCommand} && echo '${ENVIRONMENT_PREFIX}' && python ${args.join(' ')}`;
                traceVerbose(`Activating Environment to capture Environment variables, ${command}`);

                // Do some wrapping of the call. For two reasons:
                // 1) Conda activate can hang on certain systems. Fail after 30 seconds.
                // See the discussion from hidesoon in this issue: https://github.com/Microsoft/vscode-python/issues/4424
                // His issue is conda never finishing during activate. This is a conda issue, but we
                // should at least tell the user.
                // 2) Retry because of this issue here: https://github.com/microsoft/vscode-python/issues/9244
                // This happens on AzDo machines a bunch when using Conda (and we can't dictate the conda version in order to get the fix)
                let result: ExecutionResult<string> | undefined;
                let tryCount = 1;
                let returnedEnv: NodeJS.ProcessEnv | undefined;
                while (!result) {
                    try {
                        result = await processService.shellExec(command, {
                            env,
                            shell: shellInfo.shell,
                            timeout: isPossiblyCondaEnv ? CONDA_ENVIRONMENT_TIMEOUT : ENVIRONMENT_TIMEOUT,
                            maxBuffer: 1000 * 1000,
                            throwOnStdErr: false
                        });

                        try {
                            // Try to parse the output, even if we have errors in stderr, its possible they are false positives.
                            // If variables are available, then ignore errors (but log them).
                            returnedEnv = this.parseEnvironmentOutput(result.stdout, parse);
                        } catch (ex) {
                            if (!result.stderr) {
                                throw ex;
                            }
                        }
                        if (result.stderr) {
                            if (returnedEnv) {
                                traceWarning('Got env variables but with errors', result.stderr);
                            } else {
                                throw new Error(`StdErr from ShellExec, ${result.stderr} for ${command}`);
                            }
                        }
                    } catch (exc) {
                        // Special case. Conda for some versions will state a file is in use. If
                        // that's the case, wait and try again. This happens especially on AzDo
                        const excString = exc.toString();
                        if (condaRetryMessages.find((m) => excString.includes(m)) && tryCount < 10) {
                            traceInfo(`Conda is busy, attempting to retry ...`);
                            result = undefined;
                            tryCount += 1;
                            await sleep(500);
                        } else {
                            throw exc;
                        }
                    }
                }

                // Put back the PYTHONWARNINGS value
                if (oldWarnings && returnedEnv) {
                    returnedEnv[PYTHON_WARNINGS] = oldWarnings;
                } else if (returnedEnv) {
                    delete returnedEnv[PYTHON_WARNINGS];
                }
                return returnedEnv;
            } catch (e) {
                traceError('Failed to get activated enviornment variables ourselves', e);
                return;
            }
        })();

        promise.catch(() => {
            if (this.activatedEnvVariablesCache.get(key) === promise) {
                this.activatedEnvVariablesCache.delete(key);
            }
        });
        this.activatedEnvVariablesCache.set(key, promise);

        return promise;
    }
    @traceDecorators.verbose('Getting env activation commands', TraceOptions.BeforeCall | TraceOptions.Arguments)
    private async getActivationCommands(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter?: PythonEnvironment
    ): Promise<string[] | undefined> {
        if (!interpreter?.path) {
            return;
        }
        const key = ENVIRONMENT_ACTIVATION_COMMAND_CACHE_KEY_PREFIX.format(interpreter.path);
        const cachedData = this.memento.get<string[]>(key, []);
        if (cachedData && cachedData.length > 0) {
            return cachedData;
        }
        if (this.envActivationCommands.has(key)) {
            return this.envActivationCommands.get(key);
        }
        const shellInfo = defaultShells[this.platform.osType];
        if (!shellInfo) {
            return;
        }
        const promise = (async () => {
            try {
                const activationCommands = await this.apiProvider
                    .getApi()
                    .then(
                        (api) =>
                            api.getEnvironmentActivationShellCommands &&
                            api.getEnvironmentActivationShellCommands(resource, interpreter)
                    );

                if (!activationCommands || activationCommands.length === 0) {
                    return;
                }
                traceVerbose(`Activation Commands received ${activationCommands} for shell ${shellInfo.shell}`);
                void this.memento.update(key, activationCommands);
                return activationCommands;
            } catch (ex) {
                traceError(`Failed to get env activation commands for ${getDisplayPath(interpreter.path)}`, ex);
                return;
            }
        })();
        this.envActivationCommands.set(key, promise);
        return promise;
    }
    protected fixActivationCommands(commands: string[]): string[] {
        // Replace 'source ' with '. ' as that works in shell exec
        return commands.map((cmd) => cmd.replace(/^source\s+/, '. '));
    }
    @traceDecorators.error('Failed to parse Environment variables')
    @traceDecorators.verbose('parseEnvironmentOutput', TraceOptions.None)
    protected parseEnvironmentOutput(output: string, parse: (out: string) => NodeJS.ProcessEnv | undefined) {
        output = output.substring(output.indexOf(ENVIRONMENT_PREFIX) + ENVIRONMENT_PREFIX.length);
        const js = output.substring(output.indexOf('{')).trim();
        return parse(js);
    }
}
