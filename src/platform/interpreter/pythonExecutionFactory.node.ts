// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from '../common/platform/types';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IServiceContainer } from '../ioc/types';
import { IWorkspaceService } from '../common/application/types';
import { IDisposableRegistry } from '../common/types';
import { createCondaEnv, createPythonEnv } from './pythonEnvironment.node';
import { createPythonProcessService } from './pythonProcess.node';
import { ProcessService } from '../common/process/proc.node';
import { IProcessServiceFactory, IProcessService } from '../common/process/types.node';
import {
    ExecutionFactoryCreateWithEnvironmentOptions,
    ExecutionFactoryCreationOptions,
    IPythonExecutionFactory,
    IPythonExecutionService
} from './types.node';
import { Environment } from '@vscode/python-extension';
import { Uri } from 'vscode';

/**
 * Creates IPythonExecutionService objects. They can be either process based or daemon based.
 */
@injectable()
export class PythonExecutionFactory implements IPythonExecutionFactory {
    private readonly disposables: IDisposableRegistry;
    private readonly fileSystem: IFileSystem;
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IEnvironmentActivationService) private readonly activationHelper: IEnvironmentActivationService,
        @inject(IProcessServiceFactory) private readonly processServiceFactory: IProcessServiceFactory,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        // Acquire other objects here so that if we are called during dispose they are available.
        this.disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        this.fileSystem = this.serviceContainer.get<IFileSystem>(IFileSystem);
    }
    public async create(options: ExecutionFactoryCreationOptions): Promise<IPythonExecutionService> {
        const processService: IProcessService = await this.processServiceFactory.create(options.resource);

        return createPythonService(options.interpreter, processService, this.fileSystem, undefined);
    }
    public async createActivatedEnvironment(
        options: ExecutionFactoryCreateWithEnvironmentOptions
    ): Promise<IPythonExecutionService> {
        options.resource = options.resource
            ? options.resource
            : this.workspace.workspaceFolders?.length
            ? this.workspace.workspaceFolders[0].uri
            : undefined;

        // This should never happen, but if it does ensure we never run code accidentally in untrusted workspaces.
        if (!this.workspace.isTrusted) {
            throw new Error('Workspace not trusted');
        }
        const envVars = await this.activationHelper.getActivatedEnvironmentVariables(
            options.resource,
            options.interpreter
        );
        const hasEnvVars = envVars && Object.keys(envVars).length > 0;
        if (!hasEnvVars) {
            return this.create({
                resource: options.resource,
                interpreter: options.interpreter
            });
        }
        const processService: IProcessService = new ProcessService({ ...envVars });
        this.disposables.push(processService);

        return createPythonService(options.interpreter, processService, this.fileSystem);
    }
}

function createPythonService(
    interpreter: { uri: Uri; id: string } | Environment,
    procService: IProcessService,
    fs: IFileSystem,
    conda?: [
        string,
        {
            name: string;
            path: string;
        }
    ]
): IPythonExecutionService {
    let env = createPythonEnv(interpreter, procService, fs);
    if (conda) {
        const [condaPath, condaInfo] = conda;
        env = createCondaEnv(condaPath, condaInfo, interpreter, procService, fs);
    }
    const procs = createPythonProcessService(procService, env);
    return {
        isModuleInstalled: (m) => env.isModuleInstalled(m),
        execObservable: (a, o) => procs.execObservable(a, o),
        execModuleObservable: (m, a, o) => procs.execModuleObservable(m, a, o),
        exec: (a, o) => procs.exec(a, o),
        execModule: (m, a, o) => procs.execModule(m, a, o)
    };
}
