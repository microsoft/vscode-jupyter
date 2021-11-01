// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IJupyterSession, INotebook, INotebookExecutionInfo } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');

// This code is based on the examples here:
// https://www.npmjs.com/package/@jupyterlab/services

export class JupyterNotebook implements INotebook {
    private _executionInfo: INotebookExecutionInfo;
    constructor(public readonly session: IJupyterSession, executionInfo: INotebookExecutionInfo) {
        // Make a copy of the launch info so we can update it in this class
        this._executionInfo = cloneDeep(executionInfo);
    }

    public get connection() {
        return this._executionInfo.connectionInfo;
    }
}
