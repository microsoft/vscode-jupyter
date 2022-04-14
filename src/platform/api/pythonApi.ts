import { Uri } from 'vscode';
import { originalFSPath } from '../vscode-path/resources';
import { fsPathToUri } from '../vscode-path/utils';
import { PythonEnvironment } from './extension';
import { PythonEnvironment_PythonApi } from './types';

export function deserializePythonEnvironment(
    pythonVersion: Partial<PythonEnvironment_PythonApi> | undefined
): PythonEnvironment | undefined {
    if (pythonVersion) {
        return {
            ...pythonVersion,
            sysPrefix: pythonVersion.sysPrefix || '',
            uri: Uri.file(pythonVersion.path || ''),
            envPath: fsPathToUri(pythonVersion.envPath)
        };
    }
}

export function serializePythonEnvironment(
    jupyterVersion: PythonEnvironment | undefined
): PythonEnvironment_PythonApi | undefined {
    if (jupyterVersion) {
        return {
            ...jupyterVersion,
            path: originalFSPath(jupyterVersion.uri),
            envPath: jupyterVersion.envPath ? originalFSPath(jupyterVersion.envPath) : undefined
        };
    }
}
