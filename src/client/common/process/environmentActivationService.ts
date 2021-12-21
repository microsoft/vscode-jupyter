// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../extensions';

import { inject, injectable, named, optional } from 'inversify';

import { IWorkspaceService } from '../application/types';
import { IFileSystem, IPlatformService } from '../platform/types';
import * as internalScripts from './internal/scripts';
import { ExecutionResult, IProcessServiceFactory } from './types';
import { GLOBAL_MEMENTO, IDisposable, IMemento, Resource } from '../types';
import { createDeferredFromPromise, sleep } from '../utils/async';
import { OSType } from '../utils/platform';
import { EnvironmentVariables, IEnvironmentVariablesProvider } from '../variables/types';
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
import { getTelemetrySafeHashedString } from '../../telemetry/helpers';
import { CondaService } from './condaService';
import { condaVersionSupportsLiveStreaming, createCondaEnv } from './pythonEnvironment';
import { printEnvVariablesToFile } from './internal/scripts';
import { ProcessService } from './proc';
import { BufferDecoder } from './decoder';
import { testOnlyMethod } from '../utils/decorators';
import { KernelProgressReporter } from '../../datascience/progress/kernelProgressReporter';
import { DataScience } from '../utils/localize';

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
const ENVIRONMENT_ACTIVATED_ENV_VARS_KEY_PREFIX = 'ENVIRONMENT_ACTIVATED_ENV_VARS_KEY_PREFIX_V3_{0}';

export type EnvironmentVariablesCacheInformation = {
    activatedEnvVariables: EnvironmentVariables | undefined;
    originalProcEnvVariablesHash: string;
    customEnvVariablesHash: string;
    activationCommands: string[];
    interpreterVersion: string;
};

const MIN_TIME_AFTER_WHICH_WE_SHOULD_CACHE_ENV_VARS = 500;

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
 * We've found that doing this in jupyter yields much better results.// Copyright (c) Microsoft Corporation. All rights reserved.
 * Stats: In Jupyter activation takes 800ms & the same in Python would take 2.6s, or with a complex Conda (5s vs 9s).
 * Note: We cache the activate commands, as this is not something that changes day to day. Its almost a constant.
 * Either way, we always fetch the latest from Python extension & update the cache.
 */
@injectable()
export class EnvironmentActivationService implements IEnvironmentActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly activatedEnvVariablesCache = new Map<string, Promise<NodeJS.ProcessEnv | undefined>>();
    private readonly envActivationCommands = new Map<string, Promise<string[] | undefined>>();
    private static minTimeAfterWhichWeShouldCacheEnvVariables: number = MIN_TIME_AFTER_WHICH_WE_SHOULD_CACHE_ENV_VARS;
    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IProcessServiceFactory) private processServiceFactory: IProcessServiceFactory,
        @inject(CurrentProcess) private currentProcess: CurrentProcess,
        @inject(IWorkspaceService) private workspace: IWorkspaceService,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsService: IEnvironmentVariablesProvider,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(CondaService) private readonly condaService: CondaService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @optional()
        minTimeAfterWhichWeShouldCacheEnvVariables = MIN_TIME_AFTER_WHICH_WE_SHOULD_CACHE_ENV_VARS
    ) {
        EnvironmentActivationService.minTimeAfterWhichWeShouldCacheEnvVariables = minTimeAfterWhichWeShouldCacheEnvVariables;
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
    @testOnlyMethod()
    public clearCache() {
        this.activatedEnvVariablesCache.clear();
    }
    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
    @traceDecorators.verbose('Getting activated env variables', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async getActivatedEnvironmentVariables(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const title = DataScience.activatingPythonEnvironment().format(
            interpreter.displayName || getDisplayPath(interpreter.path)
        );
        return KernelProgressReporter.wrapAndReportProgress(resource, title, () =>
            this.getActivatedEnvironmentVariablesImpl(resource, interpreter)
        );
    }
    @traceDecorators.verbose('Getting activated env variables', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async getActivatedEnvironmentVariablesImpl(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter: PythonEnvironment
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
    public async getActivatedEnvironmentVariablesFromPython(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const stopWatch = new StopWatch();
        // We'll need this later.
        void this.envVarsService.getEnvironmentVariables(resource);

        // Check cache.
        const [env, customEnvVars] = await Promise.all([
            this.apiProvider.getApi().then((api) => api.getActivatedEnvironmentVariables(resource, interpreter, false)),
            this.envVarsService.getCustomEnvironmentVariables(resource)
        ]);

        const envType = interpreter.envType;
        sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
            envType,
            pythonEnvType: envType,
            source: 'python',
            failed: Object.keys(env || {}).length === 0,
            reason: 'emptyVariables'
        });
        // We must get activated env variables for Conda env, if not running stuff against conda will not work.
        // Hence we must log these as errors (so we can see them in jupyter logs).
        if (!env && envType === EnvironmentType.Conda) {
            traceError(`Failed to get activated conda env variables for ${getDisplayPath(interpreter?.path)}`);
        }

        // Store in cache if we have env vars (lets not cache if it takes <=500ms (see const) to activate an environment).
        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        const key = ENVIRONMENT_ACTIVATED_ENV_VARS_KEY_PREFIX.format(
            `${workspaceKey}_${interpreter && getInterpreterHash(interpreter)}`
        );
        if (env && stopWatch.elapsedTime > EnvironmentActivationService.minTimeAfterWhichWeShouldCacheEnvVariables) {
            const customEnvVariablesHash = getTelemetrySafeHashedString(JSON.stringify(customEnvVars));
            void this.storeActivatedEnvVariablesInCache(resource, interpreter, env, customEnvVariablesHash);
        } else if (this.memento.get(key)) {
            // Remove it from cache (if it exists).
            void this.memento.update(key, undefined);
        }
        return env;
    }
    @traceDecorators.verbose(
        'Getting activated env variables ourselves',
        TraceOptions.BeforeCall | TraceOptions.Arguments
    )
    public async getActivatedEnvironmentVariablesOurselves(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        const key = `${workspaceKey}_${interpreter && getInterpreterHash(interpreter)}`;

        const shellInfo = defaultShells[this.platform.osType];
        const envType = interpreter?.envType;
        if (!shellInfo) {
            traceWarning(
                `Cannot get activated env variables for ${getDisplayPath(
                    interpreter?.path
                )}, shell cannot be determined.`
            );
            sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, 0, {
                envType,
                pythonEnvType: envType,
                source: 'jupyter',
                failed: true,
                reason: 'unknownOS'
            });
            return;
        }

        // If this is a conda environment that supports conda run, then we don't need conda activation commands.
        const [activationCommands, customEnvVars] = await Promise.all([
            interpreter.envType === EnvironmentType.Conda
                ? Promise.resolve([])
                : this.getActivationCommands(resource, interpreter),
            this.envVarsService.getCustomEnvironmentVariables(resource)
        ]);

        // Check cache.
        const customEnvVariablesHash = getTelemetrySafeHashedString(JSON.stringify(customEnvVars));
        const cachedVariables = this.getActivatedEnvVariablesFromCache(
            resource,
            interpreter,
            customEnvVariablesHash,
            activationCommands
        );
        if (cachedVariables) {
            traceVerbose(`Got activation Env Vars from cache`);
            return cachedVariables;
        }

        if (this.activatedEnvVariablesCache.has(key)) {
            return this.activatedEnvVariablesCache.get(key);
        }

        const promise = (async () => {
            const condaActivation = async () => {
                const stopWatch = new StopWatch();
                try {
                    const env = await this.getCondaEnvVariables(resource, interpreter);
                    sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                        envType,
                        pythonEnvType: envType,
                        source: 'jupyter',
                        failed: Object.keys(env || {}).length === 0,
                        reason: Object.keys(env || {}).length === 0 ? 'emptyFromCondaRun' : undefined
                    });
                    return env;
                } catch (ex) {
                    sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                        envType,
                        pythonEnvType: envType,
                        source: 'jupyter',
                        failed: true,
                        reason: 'unhandledError'
                    });
                    traceError('Failed to get activated environment variables ourselves', ex);
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

        return promise;
    }
    public async getActivatedEnvVarsUsingActivationCommands(resource: Resource, interpreter: PythonEnvironment) {
        const shellInfo = defaultShells[this.platform.osType]!;
        const envType = interpreter?.envType;
        const stopWatch = new StopWatch();
        try {
            let isPossiblyCondaEnv = false;
            const processServicePromise = this.processServiceFactory.create(resource);

            const [activationCommands, customEnvVars] = await Promise.all([
                this.getActivationCommands(resource, interpreter),
                this.envVarsService.getEnvironmentVariables(resource)
            ]);
            const processService = await processServicePromise;
            if (!activationCommands || activationCommands.length === 0) {
                sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                    envType,
                    pythonEnvType: envType,
                    source: 'jupyter',
                    failed: true,
                    reason: 'noActivationCommands'
                });
                return;
            }
            traceVerbose(`Activation Commands received ${activationCommands} for shell ${shellInfo.shell}`);
            isPossiblyCondaEnv = activationCommands.join(' ').toLowerCase().includes('conda');
            // Run the activate command collect the environment from it.
            const activationCommand = this.fixActivationCommands(activationCommands).join(' && ');
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
                        if (returnedEnv && !condaRetryMessages.find((m) => result!.stderr!.includes(m))) {
                            traceWarning(
                                `Got env variables but with errors, stdErr:${result.stderr}, stdOut: ${result.stdout}`
                            );
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
            sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                envType,
                pythonEnvType: envType,
                source: 'jupyter',
                failed: Object.keys(env || {}).length === 0,
                reason: Object.keys(env || {}).length === 0 ? 'emptyFromPython' : undefined
            });

            return returnedEnv;
        } catch (e) {
            sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                envType,
                pythonEnvType: envType,
                source: 'jupyter',
                failed: true,
                reason: 'unhandledError'
            });
            traceError('Failed to get activated environment variables ourselves', e);
            return;
        }
    }
    @testOnlyMethod()
    public getInterpreterEnvCacheKeyForTesting(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter: PythonEnvironment
    ): string {
        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        return ENVIRONMENT_ACTIVATED_ENV_VARS_KEY_PREFIX.format(
            `${workspaceKey}_${interpreter && getInterpreterHash(interpreter)}`
        );
    }
    /**
     * We cache activated environment variables.
     * When activating environments, all activation scripts update environment variables, nothing else (after all they don't start a process).
     * The env variables can change based on the activation script, current env variables on the machine & python interpreter information.
     * If any of these change, then the env variables are invalidated.
     */
    private getActivatedEnvVariablesFromCache(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter: PythonEnvironment,
        customEnvVariablesHash: string,
        activationCommandsForNonCondaEnvironments: string[] = []
    ) {
        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        const key = ENVIRONMENT_ACTIVATED_ENV_VARS_KEY_PREFIX.format(
            `${workspaceKey}_${interpreter && getInterpreterHash(interpreter)}`
        );
        const interpreterVersion = `${interpreter.sysVersion || ''}#${interpreter.version?.raw || ''}`;
        const cachedData = this.memento.get<EnvironmentVariablesCacheInformation>(key);
        if (!cachedData || !cachedData.activatedEnvVariables) {
            return;
        }
        if (
            cachedData.interpreterVersion !== interpreterVersion ||
            cachedData.customEnvVariablesHash !== customEnvVariablesHash
        ) {
            return;
        }
        // We're interested in activation commands only for non-conda environments.
        // For conda environments, we don't care about the activation commands (as we activate either using conda activation commands
        // Or use conda run).
        // Hence for purposes of caching we don't care about the commands.
        if (
            interpreter.envType !== EnvironmentType.Conda &&
            cachedData.activationCommands.join(',').toLowerCase() !==
                (activationCommandsForNonCondaEnvironments || []).join(',').toLowerCase()
        ) {
            return;
        }
        if (
            cachedData.originalProcEnvVariablesHash !==
            getTelemetrySafeHashedString(JSON.stringify(this.sanitizedCurrentProcessEnvVars))
        ) {
            return;
        }
        this.updateWithLatestVSCodeVariables(cachedData.activatedEnvVariables);
        return cachedData.activatedEnvVariables;
    }
    private async storeActivatedEnvVariablesInCache(
        resource: Resource,
        @logValue<PythonEnvironment>('path') interpreter: PythonEnvironment,
        activatedEnvVariables: NodeJS.ProcessEnv,
        customEnvVariablesHash: string
    ) {
        let activationCommands = await this.getActivationCommands(resource, interpreter);
        if (interpreter.envType !== EnvironmentType.Conda && (!activationCommands || activationCommands.length === 0)) {
            return;
        }
        activationCommands = activationCommands || [];
        // For conda environments, we don't care about the activation commands (as we activate either using conda activation commands or conda run)
        if (interpreter.envType == EnvironmentType.Conda) {
            activationCommands = [];
        }
        const cachedData: EnvironmentVariablesCacheInformation = {
            activationCommands,
            originalProcEnvVariablesHash: getTelemetrySafeHashedString(
                JSON.stringify(this.sanitizedCurrentProcessEnvVars)
            ),
            activatedEnvVariables: activatedEnvVariables,
            interpreterVersion: `${interpreter.sysVersion || ''}#${interpreter.version?.raw || ''}`,
            customEnvVariablesHash
        };
        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        const key = ENVIRONMENT_ACTIVATED_ENV_VARS_KEY_PREFIX.format(
            `${workspaceKey}_${interpreter && getInterpreterHash(interpreter)}`
        );
        await this.memento.update(key, cachedData);
    }
    private get sanitizedCurrentProcessEnvVars() {
        // When debugging VS Code Env vars messes with the hash used for storage.
        // Even in real world we can ignore these, these should not impact the Env Variables of Conda.
        // So for the purpose of checking if env variables have changed, we'll ignore these,
        // However when returning the cached env variables we'll restore these to the latest values (so things work well when debugging VSC).
        const vars = JSON.parse(JSON.stringify(this.currentProcess.env));
        Object.keys(vars).forEach((key) => {
            if (key.startsWith('VSCODE_')) {
                delete vars[key];
            }
        });
        return vars;
    }
    private updateWithLatestVSCodeVariables(envVars: EnvironmentVariables) {
        // Restore the env vars we removed.
        const vars = JSON.parse(JSON.stringify(this.currentProcess.env));
        Object.keys(vars).forEach((key) => {
            if (key.startsWith('VSCODE_')) {
                envVars[key] = vars[key];
            }
        });
    }
    public async getCondaEnvVariables(
        resource: Resource,
        interpreter: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        void this.condaService.getCondaFile();
        const condaVersion = await this.condaService.getCondaVersion();
        if (!condaVersionSupportsLiveStreaming(condaVersion)) {
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
            this.envVarsService.getEnvironmentVariables(resource)
        ]);
        const hasCustomEnvVars = Object.keys(customEnvVars).length;
        const env = hasCustomEnvVars ? customEnvVars : { ...this.currentProcess.env };

        try {
            if (!condaExec) {
                return;
            }
            const proc = new ProcessService(new BufferDecoder(), env);
            const service = createCondaEnv(
                condaExec,
                {
                    name: interpreter.envName || '',
                    path: interpreter.path || '',
                    version: condaVersion
                },
                interpreter,
                proc,
                this.fs
            );
            const [args, parse] = printEnvVariablesToFile(tmpFile.filePath);
            const execInfo = service.getExecutionInfo(args);
            await proc.exec(execInfo.command, execInfo.args, { env, timeout: CONDA_ENVIRONMENT_TIMEOUT });
            const jsonContents = await this.fs.readLocalFile(tmpFile.filePath);
            const envVars = await parse(jsonContents);
            traceInfo(
                `Got activated conda env vars ourselves for ${getDisplayPath(interpreter.path)} in ${
                    stopWatch.elapsedTime
                }`
            );
            return envVars;
        } finally {
            tmpFile.dispose();
        }
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
