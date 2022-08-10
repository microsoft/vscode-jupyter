// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { traceDecoratorVerbose } from '../../logging';
import { TraceOptions } from '../../logging/types';
import { IWorkspaceService } from '../application/types';
import { IDisposableRegistry } from '../types';
import { ICustomEnvironmentVariablesProvider } from '../variables/types';
import { ProcessService } from './proc.node';
import { IProcessLogger, IProcessService, IProcessServiceFactory } from './types.node';

/**
 * Factory for creating ProcessService objects. Get the current interpreter from a URI to determine the starting environment.
 */
@injectable()
export class ProcessServiceFactory implements IProcessServiceFactory {
    constructor(
        @inject(ICustomEnvironmentVariablesProvider)
        private readonly envVarsService: ICustomEnvironmentVariablesProvider,
        @inject(IProcessLogger) private readonly processLogger: IProcessLogger,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}
    @traceDecoratorVerbose('Create ProcessService', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async create(resource?: Uri): Promise<IProcessService> {
        // This should never happen, but if it does ensure we never run code accidentally in untrusted workspaces.
        if (!this.workspace.isTrusted) {
            throw new Error('Workspace not trusted');
        }
        const customEnvVars = await this.envVarsService.getEnvironmentVariables(resource, 'RunNonPythonCode');
        const proc: IProcessService = new ProcessService(customEnvVars);
        this.disposableRegistry.push(proc);
        return proc.on('exec', this.processLogger.logProcess.bind(this.processLogger));
    }
}
