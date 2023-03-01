// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { inject, injectable } from 'inversify';
import * as path from '../vscode-path/path';
import { IWorkspaceService } from '../common/application/types';
import { IDisposable, Resource } from '../common/types';
import { ICustomEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../common/variables/types';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { IPythonApiProvider, IPythonExtensionChecker } from '../api/types';
import { StopWatch } from '../common/utils/stopWatch';
import { getDisplayPath } from '../common/platform/fs-paths';
import { IEnvironmentActivationService } from './activation/types';
import { IInterpreterService } from './contracts';
import { swallowExceptions } from '../common/utils/decorators';
import { DataScience } from '../common/utils/localize';
import { KernelProgressReporter } from '../progress/kernelProgressReporter';
import { Telemetry } from '../common/constants';
import { logValue, traceDecoratorVerbose, traceError, traceVerbose, traceWarning } from '../logging';
import { TraceOptions } from '../logging/types';
import { serializePythonEnvironment } from '../api/pythonApi';
import { GlobalPythonSiteService } from './globalPythonSiteService.node';
import { noop } from '../common/utils/misc';

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
        @inject(GlobalPythonSiteService) private readonly userSite: GlobalPythonSiteService
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
                 in ${stopWatch.elapsedTime}ms`
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

            const userSite = await this.userSite.getUserSitePath(interpreter).catch(noop);
            const pathValue = env.PATH || env.Path;
            const pathValues = pathValue ? pathValue.split(path.delimiter) : [];
            // First value in PATH is expected to be the directory of python executable.
            // Second value in PATH is expected to be the site packages directory.
            if (userSite && pathValues[1] !== userSite.fsPath) {
                traceVerbose(`Prepend PATH with user site path for ${interpreter.id}, user site ${userSite.fsPath}`);
                // Based on docs this is the right path and must be setup in the path.
                this.envVarsService.prependPath(env, userSite.fsPath);
            } else {
                traceError(
                    `Unable to determine site packages path for python ${interpreter.uri.fsPath} (${interpreter.envType})`
                );
            }

            // Seems to be required on windows,
            // Without this, in Python, the PATH variable inherits the process env variables and not what we give it.
            // Probably because Python uses PATH on windows as well , even if Path is provided.
            if (!env.PATH && env.Path) {
                env.PATH = env.Path;
            }
        }

        // Ensure the first path in PATH variable points to the directory of python executable.
        // We need to add this to ensure kernels start and work correctly, else things can fail miserably.
        traceVerbose(
            `Prepend PATH with python bin for ${interpreter.id}, PATH value is ${env.PATH} and Path value is ${env.Path}`
        );
        // This way all executables from that env are used.
        // This way shell commands such as `!pip`, `!python` end up pointing to the right executables.
        // Also applies to `!java` where java could be an executable in the conda bin directory.
        this.envVarsService.prependPath(env, path.dirname(interpreter.uri.fsPath));

        traceVerbose(
            `Activated Env Variables for ${interpreter.id}, PATH value is ${env.PATH} and Path value is ${env.Path}`
        );
        return env;
    }
}
