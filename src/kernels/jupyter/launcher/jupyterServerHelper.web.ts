// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { injectable } from 'inversify';
import { Resource } from '../../../platform/common/types';
import { IJupyterServerHelper } from '../types';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { DataScience } from '../../../platform/common/utils/localize';
import { IJupyterConnection } from '../../types';

@injectable()
export class JupyterServerHelper implements IJupyterServerHelper {
    public async dispose(): Promise<void> {
        //
    }

    public async connectToNotebookServer(
        _resource: Resource,
        _cancelToken: CancellationToken
    ): Promise<IJupyterConnection> {
        throw new Error('Invalid Operation in the Web');
    }
    public async getJupyterServerConnection(): Promise<IJupyterConnection | undefined> {
        return;
    }

    public async refreshCommands(): Promise<void> {
        //
    }

    public async isJupyterServerSupported(_?: CancellationToken): Promise<boolean> {
        return false;
    }

    public async getJupyterServerError(): Promise<string> {
        return DataScience.webNotSupported;
    }

    public async getUsableJupyterPython(_?: CancellationToken): Promise<PythonEnvironment | undefined> {
        return;
    }

    /* eslint-disable complexity,  */
    public connectToNotebookServerImpl(
        _resource: Resource,
        _cancelToken: CancellationToken
    ): Promise<IJupyterConnection> {
        throw new Error('Invalid Operation in the Web');
    }
}
