// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, workspace } from 'vscode';
import { traceDecoratorVerbose } from '../../logging';
import { TraceOptions } from '../../logging/types';
import { Resource } from '../types';
import { ICustomEnvironmentVariablesProvider } from '../variables/types';
import { ProcessService } from './proc.node';
import { IProcessService, IProcessServiceFactory } from './types.node';
import { trackDisposable } from '../utils/lifecycle';

/**
 * Factory for creating ProcessService objects. Get the current interpreter from a URI to determine the starting environment.
 */
@injectable()
export class ProcessServiceFactory implements IProcessServiceFactory {
    constructor(
        @inject(ICustomEnvironmentVariablesProvider)
        private readonly envVarsService: ICustomEnvironmentVariablesProvider
    ) {}
    @traceDecoratorVerbose('Create ProcessService', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async create(resource: Resource, cancelToken?: CancellationToken): Promise<IProcessService> {
        // This should never happen, but if it does ensure we never run code accidentally in untrusted workspaces.
        if (!workspace.isTrusted) {
            throw new Error('Workspace not trusted');
        }
        const customEnvVars = await this.envVarsService.getEnvironmentVariables(
            resource,
            'RunNonPythonCode',
            cancelToken
        );
        return trackDisposable(new ProcessService(customEnvVars));
    }
}
