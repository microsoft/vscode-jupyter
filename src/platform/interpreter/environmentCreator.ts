// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands, Uri } from 'vscode';
import { ServiceContainer } from '../ioc/container';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { IInterpreterService } from './contracts';

type CreateEnvironmentResult = {
    path: string | undefined;
    uri: Uri | undefined;
};

export class EnvironmentCreator {
    public async createPythonEnvironment(): Promise<PythonEnvironment | undefined> {
        const result: CreateEnvironmentResult = await commands.executeCommand('python.createEnvironment');

        if (!result) {
            return;
        }

        const interpreterService = ServiceContainer.instance.get<IInterpreterService>(IInterpreterService);
        return interpreterService.getInterpreterDetails(result.uri!);
    }
}
