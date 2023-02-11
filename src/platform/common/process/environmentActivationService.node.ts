// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import '../extensions';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { IWorkspaceService } from '../application/types';
import { IDisposable, Resource } from '../types';
import { ICustomEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../variables/types';
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
import { logValue, traceDecoratorVerbose, traceError, traceVerbose, traceWarning } from '../../logging';
import { TraceOptions } from '../../logging/types';
import { serializePythonEnvironment } from '../../api/pythonApi';
import { IPlatformService } from '../platform/types';

@injectable()
export class EnvironmentActivationService implements IEnvironmentActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly activatedEnvVariablesCache = new Map<string, Promise<NodeJS.ProcessEnv | undefined>>();
    constructor(
        @inject(IWorkspaceService) private workspace: IWorkspaceService,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(ICustomEnvironmentVariablesProvider)
        private readonly customEnvVarsService: ICustomEnvironmentVariablesProvider,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IEnvironmentVariablesService) private readonly envVarsService: IEnvironmentVariablesService,
        @inject(IPlatformService) private readonly platform: IPlatformService
    ) {
        this.customEnvVarsService.onDidEnvironmentVariablesChange(this.clearCache, this, this.disposables);
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
        const title = DataScience.activatingPythonEnvironment(
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
        const customEnvVarsPromise = this.customEnvVarsService
            .getEnvironmentVariables(resource, 'RunPythonCode')
            .catch(() => undefined);

        // Check cache.
        let reasonForFailure:
            | 'emptyVariables'
            | 'failedToGetActivatedEnvVariablesFromPython'
            | 'failedToGetCustomEnvVariables' = 'emptyVariables';
        let failureEx: Error | undefined;

        let env = await this.apiProvider.getApi().then((api) =>
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
        );

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

        if (env) {
            traceVerbose(
                `Got env vars with python ${getDisplayPath(interpreter?.uri)}, with env var count ${
                    Object.keys(env || {}).length
                } in ${stopWatch.elapsedTime}ms. \n PATH value is ${env.PATH} and Path value is ${env.Path}`
            );
        } else if (envType === EnvironmentType.Conda) {
            // We must get activated env variables for Conda env, if not running stuff against conda will not work.
            // Hence we must log these as errors (so we can see them in jupyter logs).
            traceError(
                `Failed to get activated conda env variables from Python for ${getDisplayPath(interpreter?.uri)}
                } in ${stopWatch.elapsedTime}ms`
            );
        } else {
            traceWarning(
                `Failed to get activated env vars with python ${getDisplayPath(interpreter?.uri)} in ${
                    stopWatch.elapsedTime
                }ms`
            );
        }
        if (!env) {
            // Temporary work around until https://github.com/microsoft/vscode-python/issues/20663
            const customEnvVars = await customEnvVarsPromise;
            env = {};
            this.envVarsService.mergeVariables(process.env, env); // Copy current proc vars into new obj.
            this.envVarsService.mergeVariables(customEnvVars!, env); // Copy custom vars over into obj.
            this.envVarsService.mergePaths(process.env, env);
            if (process.env.PYTHONPATH) {
                env.PYTHONPATH = process.env.PYTHONPATH;
            }
            let pathKey = customEnvVars ? Object.keys(customEnvVars).find((k) => k.toLowerCase() == 'path') : undefined;
            if (pathKey && customEnvVars![pathKey]) {
                this.envVarsService.appendPath(env, customEnvVars![pathKey]!);
            }
            if (customEnvVars!.PYTHONPATH) {
                this.envVarsService.appendPythonPath(env, customEnvVars!.PYTHONPATH);
            }

            // On unix machines if Python is installed via `apt-get install python3 python3-pip`
            // Then, just like the homebrew case above, we need to add the path to where site-packages are located
            if (
                interpreter.envType === EnvironmentType.Unknown &&
                this.platform.isLinux &&
                interpreter.uri.fsPath.startsWith('/usr/bin/python')
            ) {
                if (interpreter.version && this.platform.homeDir) {
                    const sitePackagesPath = path.join(this.platform.homeDir.fsPath, '.local', 'bin');
                    // Based on docs this is the right path and must be setup in the path.
                    // However the problem is we do not know whether this is the right python executable or not.
                    // This could be a symlink, could be the python.org version of Python as well, and those don't necessarily need such path changes
                    // Hence to avoid issues with those, lets just append, this way the right path will be used for those that do not need this.
                    this.envVarsService.appendPath(env, sitePackagesPath);
                } else {
                    traceError(
                        `Unable to determine site packages path for unix apt-get python ${interpreter.uri.fsPath}}`
                    );
                }
            }

            // This way all executables from that env are used.
            // This way shell commands such as `!pip`, `!python` end up pointing to the right executables.
            // Also applies to `!java` where java could be an executable in the conda bin directory.
            this.envVarsService.prependPath(env, path.dirname(interpreter.uri.fsPath));

            // Seems to be required on windows,
            // Without this, in Python, the PATH variable inherits the process env variables and not what we give it.
            // Probably because Python uses PATH on windows as well , even if Path is provided.
            if (!env.PATH && env.Path) {
                env.PATH = env.Path;
            }
        }

        traceVerbose(`Activated Env Variables, PATH value is ${env.PATH} and Path value is ${env.Path}`);
        return env;
    }
}
