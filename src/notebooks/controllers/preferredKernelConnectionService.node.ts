// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookDocument, workspace, Uri } from 'vscode';
import * as path from '../../platform/vscode-path/resources';
import { isParentPath } from '../../platform/common/platform/fileUtils';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { getEnvironmentType } from '../../platform/interpreter/helpers';
import { Environment, PythonExtension } from '@vscode/python-extension';

export function findPreferredPythonEnvironment(
    notebook: NotebookDocument,
    pythonApi: PythonExtension
): Environment | undefined {
    // 1. Check if we have a .conda or .venv virtual env in the local workspace folder.
    const localEnv = findPythonEnvironmentClosestToNotebook(notebook, pythonApi.environments.known);
    if (localEnv) {
        return localEnv;
    }

    const findMatchingActiveEnvironment = () => {
        const envPath = pythonApi.environments.getActiveEnvironmentPath(notebook.uri);
        return envPath && pythonApi.environments.known.find((e) => e.id === envPath.id);
    };
    // 3. Fall back to the active interpreter.
    return findMatchingActiveEnvironment();
}

function findPythonEnvironmentClosestToNotebook(notebook: NotebookDocument, envs: readonly Environment[]) {
    const defaultFolder =
        workspace.getWorkspaceFolder(notebook.uri)?.uri ||
        (workspace.workspaceFolders?.length === 1 ? workspace.workspaceFolders[0].uri : undefined);
    const localEnvNextToNbFile = findPythonEnvBelongingToFolder(path.dirname(notebook.uri), envs);
    if (localEnvNextToNbFile) {
        return localEnvNextToNbFile;
    }
    if (defaultFolder) {
        return findPythonEnvBelongingToFolder(defaultFolder, envs);
    }
}

function findPythonEnvBelongingToFolder(folder: Uri, pythonEnvs: readonly Environment[]) {
    const localEnvs = pythonEnvs.filter((p) =>
        // eslint-disable-next-line local-rules/dont-use-fspath
        isParentPath(p.environment?.folderUri?.fsPath || p.executable.uri?.fsPath || p.path, folder.fsPath)
    );

    // Find an environment that is a .venv or .conda environment.
    // Give preference to .venv over .conda.
    // & give preference to .venv or .conda over any other environment.
    return localEnvs.find(
        (e) => getEnvironmentType(e) === EnvironmentType.Venv && e.environment?.name?.toLowerCase() === '.venv'
    ) ||
        localEnvs.find(
            (e) => getEnvironmentType(e) === EnvironmentType.Conda && e.environment?.name?.toLowerCase() === '.conda'
        ) ||
        localEnvs.find(
            (e) =>
                [EnvironmentType.VirtualEnv, EnvironmentType.VirtualEnvWrapper].includes(getEnvironmentType(e)) &&
                e.environment?.name?.toLowerCase() === '.venv'
        ) ||
        localEnvs.find(
            (e) => e.environment?.name?.toLowerCase() === '.venv' || e.environment?.name?.toLowerCase() === '.conda'
        ) ||
        localEnvs.length
        ? localEnvs[0]
        : undefined;
}
