// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../extensions';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { inject, injectable, named } from 'inversify';

import { IWorkspaceService } from '../application/types';
import { IPlatformService } from '../platform/types';
import * as internalScripts from './internal/scripts/index.node';
import { ExecutionResult, IProcessServiceFactory } from './types.node';
import { GLOBAL_MEMENTO, IDisposable, IMemento, Resource } from '../types';
import { createDeferredFromPromise, sleep } from '../utils/async';
import { OSType } from '../utils/platform';
import { EnvironmentVariables, ICustomEnvironmentVariablesProvider } from '../variables/types';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { IPythonApiProvider } from '../../api/types';
import { StopWatch } from '../utils/stopWatch';
import { Memento, Uri } from 'vscode';
import { getDisplayPath } from '../platform/fs-paths';
import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { CondaService } from './condaService.node';
import { condaVersionSupportsLiveStreaming, createCondaEnv } from './pythonEnvironment.node';
import { printEnvVariablesToFile } from './internal/scripts/index.node';
import { ProcessService } from './proc.node';
import { swallowExceptions } from '../utils/decorators';
import { DataScience } from '../utils/localize';
import { KernelProgressReporter } from '../../progress/kernelProgressReporter';
import { Telemetry } from '../constants';
import { IFileSystemNode } from '../platform/types.node';
import { logValue, traceDecoratorVerbose, traceError, traceInfo, traceVerbose, traceWarning } from '../../logging';
import { TraceOptions } from '../../logging/types';
import { serializePythonEnvironment } from '../../api/pythonApi';
import { noop } from '../utils/misc';

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

export type EnvironmentVariablesCacheInformation = {
    activatedEnvVariables: EnvironmentVariables | undefined;
    originalProcEnvVariablesHash: string;
    customEnvVariablesHash: string;
    activationCommands: string[];
    interpreterVersion: string;
};

/**
 * Assumption reader is aware of why we need `getActivatedEnvironmentVariables`.
 * When calling the Python API to get this information it takes a while 1-3s.
 * However, when you think of this, all we do to get the activated env variables is as follows:
 * 1. Get the CLI used to activate a Python environment
 * 2. Activate the Python environment using the CLI
 * 3. In the same process, now run `python -c "import os; print(os.environ)"` to print all of the env variables.
 *
 * Solution:
 * 1. Get the commands from Python extension to activate a Python environment.
 * 2. Activate & generate the env variables ourselves.
 * 3. In parallel get the activated env variables from cache.
 * 3. In parallel get the activated env variables from Python extension.
 * 4. Return the results from which ever completes first.
 *
 * Once env variables have been generated, we cache them.
 *
 * We've found that doing this in jupyter yields much better results.
 * Stats: In Jupyter activation takes 800ms & the same in Python would take 2.6s, or with a complex Conda (5s vs 9s).
 * Note: We cache the activate commands, as this is not something that changes day to day. Its almost a constant.
 * Either way, we always fetch the latest from Python extension & update the cache.
 */
@injectable()
export class EnvironmentActivationService implements IEnvironmentActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly activatedEnvVariablesCache = new Map<string, Promise<NodeJS.ProcessEnv | undefined>>();
    private readonly envActivationCommands = new Map<string, Promise<string[] | undefined>>();
    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IProcessServiceFactory) private processServiceFactory: IProcessServiceFactory,
        @inject(IWorkspaceService) private workspace: IWorkspaceService,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(ICustomEnvironmentVariablesProvider)
        private readonly envVarsService: ICustomEnvironmentVariablesProvider,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(CondaService) private readonly condaService: CondaService,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode
    ) {
        this.envVarsService.onDidEnvironmentVariablesChange(this.clearCache, this, this.disposables);
        this.interpreterService.onDidChangeInterpreter(this.clearCache, this, this.disposables);
    }
    public clearCache() {
        this.activatedEnvVariablesCache.clear();
    }
    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
    @traceDecoratorVerbose('Getting activated env variables', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async getActivatedEnvironmentVariables(
        resource: Resource,
        @logValue<PythonEnvironment>('uri') interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const title = DataScience.activatingPythonEnvironment().format(
            interpreter.displayName || getDisplayPath(interpreter.uri)
        );
        return KernelProgressReporter.wrapAndReportProgress(resource, title, () =>
            this.getActivatedEnvironmentVariablesImpl(resource, interpreter)
        );
    }
    @traceDecoratorVerbose('Getting activated env variables impl', TraceOptions.BeforeCall | TraceOptions.Arguments)
    private async getActivatedEnvironmentVariablesImpl(
        resource: Resource,
        @logValue<PythonEnvironment>('uri') interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const stopWatch = new StopWatch();
        const envVariablesOurSelves = createDeferredFromPromise(
            this.getActivatedEnvironmentVariablesOurselves(resource, interpreter)
        );
        const envVariablesFromPython = createDeferredFromPromise(
            this.getActivatedEnvironmentVariablesFromPython(resource, interpreter)
        );

        envVariablesFromPython.promise
            .then((env) =>
                traceVerbose(
                    `Got env vars with python ${getDisplayPath(interpreter?.uri)} in ${stopWatch.elapsedTime}ms with ${
                        Object.keys(env || {}).length
                    } variables`
                )
            )
            .catch((ex) =>
                traceError(
                    `Failed to get env vars with python ${getDisplayPath(interpreter?.uri)} in ${
                        stopWatch.elapsedTime
                    }ms`,
                    ex
                )
            );
        envVariablesOurSelves.promise
            .then((env) =>
                traceVerbose(
                    `Got env vars ourselves ${getDisplayPath(interpreter?.uri)} in ${stopWatch.elapsedTime}ms with ${
                        Object.keys(env || {}).length
                    } variables`
                )
            )
            .catch((ex) =>
                traceError(
                    `Failed to get env vars with ourselves ${getDisplayPath(interpreter?.uri)} in ${
                        stopWatch.elapsedTime
                    }ms`,
                    ex
                )
            );
        await Promise.race([envVariablesOurSelves.promise, envVariablesFromPython.promise]);
        // If this is a conda environment and we get empty env variables from the Python extension,
        // Then try our approach.
        // This could happen when Python extension fails to get the activated env variables.
        if (
            interpreter.envType === EnvironmentType.Conda &&
            envVariablesFromPython.completed &&
            !envVariablesFromPython.value
        ) {
            traceWarning(
                `Failed to get env vars from Python extension. Falling back to ours for ${getDisplayPath(
                    interpreter.uri
                )}.`
            );
            await envVariablesOurSelves.promise;
        }

        // Give preference to environment variables from Python extension.
        if (envVariablesFromPython.resolved) {
            if (envVariablesFromPython.value) {
                traceInfo(
                    `Got env vars from Python Ext ${
                        envVariablesOurSelves.resolved && envVariablesOurSelves.value
                            ? ' as quickly as Jupyter code'
                            : 'faster'
                    } ${getDisplayPath(interpreter?.uri)} with env var count ${
                        Object.keys(envVariablesFromPython.value).length
                    } in ${stopWatch.elapsedTime}ms`
                );
                return envVariablesFromPython.value;
            } else {
                traceVerbose(`Got env vars from Python faster, but empty ${getDisplayPath(interpreter?.uri)}`);
            }
        }
        return envVariablesOurSelves.promise;
    }
    @traceDecoratorVerbose(
        'Getting activated env variables from Python',
        TraceOptions.BeforeCall | TraceOptions.Arguments
    )
    @swallowExceptions('Get activated env variables from Python')
    public async getActivatedEnvironmentVariablesFromPython(
        resource: Resource,
        @logValue<PythonEnvironment>('uri') interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        resource = resource
            ? resource
            : this.workspace.workspaceFolders?.length
            ? this.workspace.workspaceFolders[0].uri
            : undefined;
        const stopWatch = new StopWatch();
        // We'll need this later.
        this.envVarsService.getEnvironmentVariables(resource, 'RunPythonCode').catch(noop);

        // Check cache.
        let reasonForFailure:
            | 'emptyVariables'
            | 'failedToGetActivatedEnvVariablesFromPython'
            | 'failedToGetCustomEnvVariables' = 'emptyVariables';
        let failureEx: Error | undefined;
        let [env, customEnvVars] = await Promise.all([
            this.apiProvider.getApi().then((api) =>
                api
                    .getActivatedEnvironmentVariables(resource, serializePythonEnvironment(interpreter)!, false)
                    .catch((ex) => {
                        traceError(
                            `Failed to get activated env variables from Python Extension for ${getDisplayPath(
                                interpreter.uri
                            )}`,
                            ex
                        );
                        reasonForFailure = 'failedToGetActivatedEnvVariablesFromPython';
                        return undefined;
                    })
            ),
            this.envVarsService.getCustomEnvironmentVariables(resource, 'RunPythonCode').catch((ex) => {
                traceError(
                    `Failed to get activated env variables from Python Extension for ${getDisplayPath(
                        interpreter.uri
                    )}`,
                    ex
                );
                reasonForFailure = 'failedToGetCustomEnvVariables';
                failureEx = ex;
                return undefined;
            })
        ]);

        const envType = interpreter.envType;
        sendTelemetryEvent(
            Telemetry.GetActivatedEnvironmentVariables,
            { duration: stopWatch.elapsedTime },
            {
                envType,
                source: 'python',
                failed: Object.keys(env || {}).length === 0,
                reason: reasonForFailure
            },
            failureEx
        );
        // We must get activated env variables for Conda env, if not running stuff against conda will not work.
        // Hence we must log these as errors (so we can see them in jupyter logs).
        if (!env && envType === EnvironmentType.Conda) {
            traceError(
                `Failed to get activated conda env variables from Python for ${getDisplayPath(interpreter?.uri)}`
            );
        }

        if (env) {
            traceInfo(
                `Got env vars with python ${getDisplayPath(interpreter?.uri)}, with env var count ${
                    Object.keys(env || {}).length
                } and custom env var count ${Object.keys(customEnvVars || {}).length} in ${stopWatch.elapsedTime}ms`
            );
        } else {
            traceInfo(
                `Got empty env vars with python ${getDisplayPath(interpreter?.uri)} in ${stopWatch.elapsedTime}ms`
            );
        }

        if (env && customEnvVars) {
            env = {
                ...env,
                ...customEnvVars
            };
        }
        return env;
    }
    @traceDecoratorVerbose(
        'Getting activated env variables ourselves',
        TraceOptions.BeforeCall | TraceOptions.Arguments
    )
    @swallowExceptions('Get activated env variables from Jupyter')
    public async getActivatedEnvironmentVariablesOurselves(
        resource: Resource,
        @logValue<PythonEnvironment>('uri') interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        const key = `${workspaceKey}_${interpreter?.id || ''}`;

        if (this.activatedEnvVariablesCache.has(key)) {
            traceVerbose(`Got activation Env Vars from cached promise with key ${key}`);
            return this.activatedEnvVariablesCache.get(key);
        }

        const shellInfo = defaultShells[this.platform.osType];
        const envType = interpreter?.envType;
        if (!shellInfo) {
            traceVerbose(
                `Cannot get activated env variables for ${getDisplayPath(
                    interpreter?.uri
                )}, shell cannot be determined.`
            );
            sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, undefined, {
                envType,
                source: 'jupyter',
                failed: true,
                reason: 'unknownOS'
            });
            return;
        }

        const promise = (async () => {
            const condaActivation = async () => {
                const stopWatch = new StopWatch();
                try {
                    const env = await this.getCondaEnvVariables(resource, interpreter);
                    sendTelemetryEvent(
                        Telemetry.GetActivatedEnvironmentVariables,
                        { duration: stopWatch.elapsedTime },
                        {
                            envType,
                            source: 'jupyter',
                            failed: Object.keys(env || {}).length === 0,
                            reason: Object.keys(env || {}).length === 0 ? 'emptyFromCondaRun' : undefined
                        }
                    );
                    return env;
                } catch (ex) {
                    sendTelemetryEvent(
                        Telemetry.GetActivatedEnvironmentVariables,
                        { duration: stopWatch.elapsedTime },
                        {
                            envType,
                            source: 'jupyter',
                            failed: true,
                            reason: 'unhandledError'
                        },
                        ex
                    );
                    traceVerbose('Failed to get activated environment variables ourselves', ex);
                } finally {
                    traceVerbose(`getCondaEnvVariables and send telemetry took: ${stopWatch.elapsedTime}ms`);
                }
            };

            if (interpreter.envType !== EnvironmentType.Conda) {
                return this.getActivatedEnvVarsUsingActivationCommands(resource, interpreter);
            }
            return condaActivation();
        })();

        promise.catch(() => {
            if (this.activatedEnvVariablesCache.get(key) === promise) {
                this.activatedEnvVariablesCache.delete(key);
            }
        });
        this.activatedEnvVariablesCache.set(key, promise);
        traceVerbose(`Got activation Env Vars without any caching. Key is ${key}`);

        return promise;
    }
    public async getActivatedEnvVarsUsingActivationCommands(resource: Resource, interpreter: PythonEnvironment) {
        const shellInfo = defaultShells[this.platform.osType]!;
        const interpreterDetails = await this.interpreterService.getInterpreterDetails(interpreter.uri);
        const envType = interpreterDetails?.envType;
        const stopWatch = new StopWatch();
        try {
            let isPossiblyCondaEnv = false;
            const [processService, activationCommands, customEnvVars] = await Promise.all([
                this.processServiceFactory.create(resource),
                this.getActivationCommands(resource, interpreterDetails || interpreter),
                this.envVarsService.getEnvironmentVariables(resource, 'RunPythonCode')
            ]);
            const hasCustomEnvVars = Object.keys(customEnvVars).length;
            if (!activationCommands || activationCommands.length === 0) {
                sendTelemetryEvent(
                    Telemetry.GetActivatedEnvironmentVariables,
                    { duration: stopWatch.elapsedTime },
                    {
                        envType,
                        source: 'jupyter',
                        failed: true,
                        reason: 'noActivationCommands'
                    }
                );
                return hasCustomEnvVars ? { ...this.processEnv, ...customEnvVars } : undefined;
            }
            traceVerbose(`Activation Commands received ${activationCommands} for shell ${shellInfo.shell}`);
            isPossiblyCondaEnv = activationCommands.join(' ').toLowerCase().includes('conda');
            // Run the activate command collect the environment from it.
            const activationCommand = this.fixActivationCommands(activationCommands).join(' && ');
            const env = hasCustomEnvVars ? { ...this.processEnv, ...customEnvVars } : { ...this.processEnv };

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
            let reason: 'emptyFromPython' | 'condaActivationFailed' = 'emptyFromPython';
            let lastError: Error | undefined;
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
                        traceVerbose(`Failed to parse Environment variables`, ex);
                        if (!result.stderr) {
                            throw ex;
                        }
                    }
                    if (result.stderr) {
                        if (returnedEnv && !condaRetryMessages.find((m) => result!.stderr!.includes(m))) {
                            traceVerbose(
                                `Got env variables but with errors, stdErr:${result.stderr}, stdOut: ${result.stdout}`
                            );
                        } else {
                            throw new Error(`StdErr from ShellExec, ${result.stderr} for ${command}`);
                        }
                    }
                    lastError = undefined;
                } catch (exc) {
                    // Special case. Conda for some versions will state a file is in use. If
                    // that's the case, wait and try again. This happens especially on AzDo
                    const excString = exc.toString();
                    if (condaRetryMessages.find((m) => excString.includes(m)) && tryCount < 10) {
                        traceVerbose(`Conda is busy, attempting to retry ...`);
                        result = undefined;
                        tryCount += 1;
                        await sleep(500);
                    } else {
                        throw exc;
                    }
                    reason = 'condaActivationFailed';
                    lastError = exc;
                }
            }

            // Put back the PYTHONWARNINGS value
            if (oldWarnings && returnedEnv) {
                returnedEnv[PYTHON_WARNINGS] = oldWarnings;
            } else if (returnedEnv) {
                delete returnedEnv[PYTHON_WARNINGS];
            }
            sendTelemetryEvent(
                Telemetry.GetActivatedEnvironmentVariables,
                { duration: stopWatch.elapsedTime },
                {
                    envType,
                    source: 'jupyter',
                    failed: Object.keys(returnedEnv || {}).length === 0,
                    reason: Object.keys(returnedEnv || {}).length === 0 ? reason : undefined
                },
                Object.keys(returnedEnv || {}).length === 0 ? lastError : undefined
            );

            return returnedEnv;
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.GetActivatedEnvironmentVariables,
                { duration: stopWatch.elapsedTime },
                {
                    envType,
                    source: 'jupyter',
                    failed: true,
                    reason: 'unhandledError'
                },
                ex
            );
            traceVerbose('Failed to get activated environment variables ourselves', ex);
            return;
        }
    }

    private get processEnv(): EnvironmentVariables {
        return process.env as unknown as EnvironmentVariables;
    }

    @traceDecoratorVerbose('getCondaEnvVariables', TraceOptions.BeforeCall)
    public async getCondaEnvVariables(
        resource: Resource,
        interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const condaVersion = await this.condaService.getCondaVersion();
        if (condaVersionSupportsLiveStreaming(condaVersion)) {
            return this.getActivatedEnvVarsUsingActivationCommands(resource, interpreter);
        }
        return this.getCondaEnvVariablesImpl(interpreter, resource);
    }
    private async getCondaEnvVariablesImpl(
        interpreter: PythonEnvironment,
        resource: Resource
    ): Promise<NodeJS.ProcessEnv | undefined> {
        if (interpreter.envType !== EnvironmentType.Conda) {
            return;
        }
        const stopWatch = new StopWatch();
        const [condaExec, condaVersion, tmpFile, customEnvVars] = await Promise.all([
            this.condaService.getCondaFile(),
            this.condaService.getCondaVersion(),
            this.fs.createTemporaryLocalFile('.json'),
            this.envVarsService.getEnvironmentVariables(resource, 'RunPythonCode')
        ]);
        const hasCustomEnvVars = Object.keys(customEnvVars).length;
        const env = hasCustomEnvVars ? { ...this.processEnv, ...customEnvVars } : { ...this.processEnv };

        try {
            if (!condaExec) {
                return;
            }
            const proc = new ProcessService(env);
            const service = createCondaEnv(
                condaExec.fsPath,
                {
                    name: interpreter.envName || '',
                    path: interpreter.uri.fsPath || '',
                    version: condaVersion
                },
                interpreter,
                proc,
                this.fs
            );
            const [args, parse] = printEnvVariablesToFile(tmpFile.filePath);
            const execInfo = service.getExecutionInfo(args);
            await proc.exec(execInfo.command, execInfo.args, { env, timeout: CONDA_ENVIRONMENT_TIMEOUT });
            const jsonContents = await this.fs.readFile(Uri.file(tmpFile.filePath));
            const envVars = await parse(jsonContents);
            traceVerbose(
                `Got activated conda env vars ourselves for ${getDisplayPath(interpreter.uri)} in ${
                    stopWatch.elapsedTime
                }`
            );
            return envVars;
        } finally {
            tmpFile.dispose();
        }
    }
    @traceDecoratorVerbose('Getting env activation commands', TraceOptions.BeforeCall | TraceOptions.Arguments)
    private async getActivationCommands(
        resource: Resource,
        @logValue<PythonEnvironment>('uri') interpreter?: PythonEnvironment
    ): Promise<string[] | undefined> {
        if (!interpreter?.uri) {
            return;
        }
        traceVerbose(`Getting activation commands for ${interpreter.uri}`);
        const key = ENVIRONMENT_ACTIVATION_COMMAND_CACHE_KEY_PREFIX.format(interpreter.uri.fsPath);
        const cachedData = this.memento.get<string[]>(key, []);
        if (cachedData && cachedData.length > 0) {
            traceVerbose(`Getting activation commands for ${interpreter.uri} are cached.`);
            return cachedData;
        }
        if (this.envActivationCommands.has(key)) {
            traceVerbose(`Getting activation commands for ${interpreter.uri} are cached with a promise.`);
            return this.envActivationCommands.get(key);
        }
        const shellInfo = defaultShells[this.platform.osType];
        if (!shellInfo) {
            traceVerbose(`No activation commands for ${interpreter.uri}, as the OS is unknown.`);
            return;
        }
        const promise = (async () => {
            try {
                const activationCommands = await this.apiProvider
                    .getApi()
                    .then(
                        (api) =>
                            api.getEnvironmentActivationShellCommands &&
                            api.getEnvironmentActivationShellCommands(resource, serializePythonEnvironment(interpreter))
                    );

                if (!activationCommands || activationCommands.length === 0) {
                    return;
                }
                traceVerbose(`Activation Commands received ${activationCommands} for shell ${shellInfo.shell}`);
                this.memento.update(key, activationCommands).then(noop, noop);
                return activationCommands;
            } catch (ex) {
                traceVerbose(`Failed to get env activation commands for ${getDisplayPath(interpreter.uri)}`, ex);
                return;
            }
        })();
        this.envActivationCommands.set(key, promise);
        traceVerbose(`Getting activation commands for ${interpreter.uri} are not cached. May take a while.`);
        return promise;
    }
    protected fixActivationCommands(commands: string[]): string[] {
        // Replace 'source ' with '. ' as that works in shell exec
        return commands.map((cmd) => cmd.replace(/^source\s+/, '. '));
    }
    @traceDecoratorVerbose('parseEnvironmentOutput', TraceOptions.None)
    protected parseEnvironmentOutput(output: string, parse: (out: string) => NodeJS.ProcessEnv | undefined) {
        output = output.substring(output.indexOf(ENVIRONMENT_PREFIX) + ENVIRONMENT_PREFIX.length);
        const js = output.substring(output.indexOf('{')).trim();
        return parse(js);
    }
}
