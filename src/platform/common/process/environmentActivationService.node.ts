// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import '../extensions';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { inject, injectable } from 'inversify';

import { IWorkspaceService } from '../application/types';
import { IDisposable, Resource } from '../types';
import { ICustomEnvironmentVariablesProvider } from '../variables/types';
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
import { noop } from '../utils/misc';

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
        this.envVarsService.getEnvironmentVariables(resource, 'RunPythonCode').catch(noop);

        // Check cache.
        let reasonForFailure:
            | 'emptyVariables'
            | 'failedToGetActivatedEnvVariablesFromPython'
            | 'failedToGetCustomEnvVariables' = 'emptyVariables';
        let failureEx: Error | undefined;
        const env = await this.apiProvider.getApi().then((api) =>
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
                } in ${stopWatch.elapsedTime}ms. \n PATH value is ${env.PATH} and Path value is ${env.Path}`
            );
        } else {
            traceWarning(
                `Failed to get env vars with python ${getDisplayPath(interpreter?.uri)} in ${stopWatch.elapsedTime}ms`
            );
        }

        return env;
    }
}
