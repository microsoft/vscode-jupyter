// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { PythonEnvironmentApi } from './api';

let _extApi: PythonEnvironmentApi | undefined;
export async function getEnvExtApi(): Promise<PythonEnvironmentApi | undefined> {
    if (_extApi) {
        return _extApi;
    }
    const extension = vscode.extensions.getExtension<PythonEnvironmentApi>('ms-python.vscode-python-envs');
    if (!extension) {
        return undefined;
    }
    if (extension.isActive) {
        _extApi = extension.exports;
        return _extApi;
    }

    await extension.activate();

    _extApi = extension.exports;
    return _extApi;
}

export function resetEnvExtApi(): void {
    _extApi = undefined;
}
