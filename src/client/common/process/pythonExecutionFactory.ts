// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { IPlatformService } from '../../common/platform/types';
import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { ignoreLogging, TraceOptions } from '../../logging/trace';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { IWorkspaceService } from '../application/types';
import { traceDecorators, traceError, traceInfo } from '../logger';
import { getDisplayPath } from '../platform/fs-paths';
import { IFileSystem } from '../platform/types';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../types';
import { ProcessService } from './proc';
import { PythonDaemonFactory } from './pythonDaemonFactory';
import { PythonDaemonExecutionServicePool } from './pythonDaemonPool';
import { createCondaEnv, createPythonEnv, createWindowsStoreEnv } from './pythonEnvironment';
import { createPythonProcessService } from './pythonProcess';
import {
    DaemonExecutionFactoryCreationOptions,
    ExecutionFactoryCreateWithEnvironmentOptions,
    ExecutionFactoryCreationOptions,
    IBufferDecoder,
    IProcessLogger,
    IProcessService,
    IProcessServiceFactory,
    IPythonDaemonExecutionService,
    IPythonExecutionFactory,
    IPythonExecutionService,
    isDaemonPoolCreationOption
} from './types';

// Minimum version number of conda required to be able to use 'conda run'
export const CONDA_RUN_VERSION = '4.6.0';

@injectable()
export class PythonExecutionFactory implements IPythonExecutionFactory {
    private readonly daemonsPerPythonService = new Map<string, Promise<IPythonDaemonExecutionService>>();
    private readonly disposables: IDisposableRegistry;
    private readonly logger: IProcessLogger;
    private readonly fileSystem: IFileSystem;
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IEnvironmentActivationService) private readonly activationHelper: IEnvironmentActivationService,
        @inject(IProcessServiceFactory) private readonly processServiceFactory: IProcessServiceFactory,
        @inject(IBufferDecoder) private readonly decoder: IBufferDecoder,
        @inject(IPlatformService) private readonly platformService: IPlatformService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IConfigurationService) private readonly config: IConfigurationService
    ) {
        // Acquire other objects here so that if we are called during dispose they are available.
        this.disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        this.logger = this.serviceContainer.get<IProcessLogger>(IProcessLogger);
        this.fileSystem = this.serviceContainer.get<IFileSystem>(IFileSystem);
    }
    @traceDecorators.verbose('Creating execution process')
    public async create(options: ExecutionFactoryCreationOptions): Promise<IPythonExecutionService> {
        const interpreter = options.interpreter || (await this.getPythonPath(options.resource));
        const processService: IProcessService = await this.processServiceFactory.create(options.resource);

        return createPythonService(
            interpreter,
            processService,
            this.fileSystem,
            undefined,
            interpreter.envType === EnvironmentType.WindowsStore
        );
    }

    @traceDecorators.verbose('Create daemon', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async createDaemon<T extends IPythonDaemonExecutionService | IDisposable>(
        options: DaemonExecutionFactoryCreationOptions
    ): Promise<T | IPythonExecutionService> {
        const daemonPoolKey = `${options.interpreter.path}#${options.daemonClass || ''}#${options.daemonModule || ''}`;
        const interpreterService = this.serviceContainer.tryGet<IInterpreterService>(IInterpreterService);
        const interpreter = options.interpreter;
        const activatedProcPromise = this.createActivatedEnvironment({
            allowEnvironmentFetchExceptions: true,
            interpreter: options.interpreter,
            resource: options.resource,
            bypassCondaExecution: true
        });
        // No daemon support in Python 2.7 or during shutdown
        if (
            !interpreterService ||
            (interpreter?.version && interpreter.version.major < 3) ||
            this.config.getSettings().disablePythonDaemon
        ) {
            traceInfo(`Not using daemon support for ${getDisplayPath(options.interpreter.path)}`);
            return activatedProcPromise;
        }

        // Ensure we do not start multiple daemons for the same interpreter.
        // Cache the promise.
        const start = async (): Promise<T> => {
            const [activatedProc, activatedEnvVars] = await Promise.all([
                activatedProcPromise,
                this.activationHelper.getActivatedEnvironmentVariables(options.resource, interpreter, true)
            ]);

            if (isDaemonPoolCreationOption(options)) {
                traceInfo(
                    `Creating daemon pool for ${getDisplayPath(options.interpreter.path)} with env variables count ${
                        Object.keys(activatedEnvVars || {}).length
                    }`
                );
                const daemon = new PythonDaemonExecutionServicePool(
                    this.logger,
                    this.disposables,
                    { ...options, interpreter: options.interpreter },
                    activatedProc!,
                    this.platformService,
                    activatedEnvVars
                );
                await daemon.initialize();
                this.disposables.push(daemon);
                return (daemon as unknown) as T;
            } else {
                traceInfo(
                    `Creating daemon process for ${getDisplayPath(options.interpreter.path)} with env variables count ${
                        Object.keys(activatedEnvVars || {}).length
                    }`
                );
                const factory = new PythonDaemonFactory(
                    this.disposables,
                    { ...options, interpreter: options.interpreter },
                    activatedProc!,
                    this.platformService,
                    activatedEnvVars
                );
                return factory.createDaemonService<T>();
            }
        };

        let promise: Promise<T>;

        if (isDaemonPoolCreationOption(options)) {
            // Ensure we do not create multiple daemon pools for the same python interpreter.
            promise = (this.daemonsPerPythonService.get(daemonPoolKey) as unknown) as Promise<T>;
            if (!promise) {
                promise = start();
                this.daemonsPerPythonService.set(daemonPoolKey, promise as Promise<IPythonDaemonExecutionService>);
            }
        } else {
            promise = start();
        }
        return promise.catch((ex) => {
            // Ok, we failed to create the daemon (or failed to start).
            // What ever the cause, we need to log this & give a standard IPythonExecutionService
            traceError('Failed to create the daemon service, defaulting to activated environment', ex);
            this.daemonsPerPythonService.delete(daemonPoolKey);
            return (activatedProcPromise as unknown) as T;
        });
    }
    @traceDecorators.verbose('Create activated Env', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async createActivatedEnvironment(
        @ignoreLogging() options: ExecutionFactoryCreateWithEnvironmentOptions
    ): Promise<IPythonExecutionService> {
        // This should never happen, but if it does ensure we never run code accidentally in untrusted workspaces.
        if (!this.workspace.isTrusted) {
            throw new Error('Workspace not trusted');
        }
        const envVars = await this.activationHelper.getActivatedEnvironmentVariables(
            options.resource,
            options.interpreter,
            options.allowEnvironmentFetchExceptions
        );
        const hasEnvVars = envVars && Object.keys(envVars).length > 0;
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES, undefined, { hasEnvVars });
        if (!hasEnvVars) {
            return this.create({
                resource: options.resource,
                interpreter: options.interpreter
            });
        }
        const processService: IProcessService = new ProcessService(this.decoder, { ...envVars });
        processService.on('exec', this.logger.logProcess.bind(this.logger));
        this.disposables.push(processService);

        return createPythonService(options.interpreter, processService, this.fileSystem);
    }

    private async getPythonPath(resource: Resource): Promise<string> {
        const interpreter = await this.interpreterService.getActiveInterpreter(resource);
        return interpreter?.path ?? 'python';
    }
}

function createPythonService(
    interpreter: PythonEnvironment,
    procService: IProcessService,
    fs: IFileSystem,
    conda?: [
        string,
        {
            name: string;
            path: string;
        }
    ],
    isWindowsStore?: boolean
): IPythonExecutionService {
    let env = createPythonEnv(interpreter, procService, fs);
    if (conda) {
        const [condaPath, condaInfo] = conda;
        env = createCondaEnv(condaPath, condaInfo, interpreter, procService, fs);
    } else if (isWindowsStore) {
        env = createWindowsStoreEnv(interpreter, procService);
    }
    const procs = createPythonProcessService(procService, env);
    return {
        getInterpreterInformation: () => env.getInterpreterInformation(),
        getExecutablePath: () => env.getExecutablePath(),
        isModuleInstalled: (m) => env.isModuleInstalled(m),
        getExecutionInfo: (a) => env.getExecutionInfo(a),
        execObservable: (a, o) => procs.execObservable(a, o),
        execModuleObservable: (m, a, o) => procs.execModuleObservable(m, a, o),
        exec: (a, o) => procs.exec(a, o),
        execModule: (m, a, o) => procs.execModule(m, a, o)
    };
}
