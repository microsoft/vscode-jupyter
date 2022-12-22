// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../extensions';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { inject, injectable } from 'inversify';

import { IWorkspaceService } from '../application/types';
import { IDisposable, Resource } from '../types';
import { OSType } from '../utils/platform';
import { EnvironmentVariables, ICustomEnvironmentVariablesProvider } from '../variables/types';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { StopWatch } from '../utils/stopWatch';
import { getDisplayPath } from '../platform/fs-paths';
import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { swallowExceptions } from '../utils/decorators';
import { DataScience } from '../utils/localize';
import { KernelProgressReporter } from '../../progress/kernelProgressReporter';
import { Telemetry } from '../constants';
import { logValue, traceDecoratorVerbose, traceError, traceVerbose } from '../../logging';
import { TraceOptions } from '../../logging/types';
import { serializePythonEnvironment } from '../../api/pythonApi';
import { noop } from '../utils/misc';

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
    constructor(
        @inject(IWorkspaceService) private workspace: IWorkspaceService,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(ICustomEnvironmentVariablesProvider)
        private readonly envVarsService: ICustomEnvironmentVariablesProvider,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
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
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        const stopWatch = new StopWatch();
        return this.getActivatedEnvironmentVariablesFromPython(resource, interpreter)
            .then((env) => {
                traceVerbose(
                    `Got env vars with python ${getDisplayPath(interpreter?.uri)} in ${stopWatch.elapsedTime}ms with ${
                        Object.keys(env || {}).length
                    } variables`
                );
                return env;
            })
            .catch((ex) => {
                traceError(
                    `Failed to get env vars with python ${getDisplayPath(interpreter?.uri)} in ${
                        stopWatch.elapsedTime
                    }ms`,
                    ex
                );
                return undefined;
            });
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
            traceVerbose(
                `Got env vars with python ${getDisplayPath(interpreter?.uri)}, with env var count ${
                    Object.keys(env || {}).length
                } and custom env var count ${Object.keys(customEnvVars || {}).length} in ${stopWatch.elapsedTime}ms`
            );
        } else {
            traceVerbose(
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
}
