// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { env, NotebookDocument, workspace, Uri, commands } from 'vscode';
import * as path from '../../platform/vscode-path/resources';
import { isParentPath } from '../../platform/common/platform/fileUtils';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { getEnvironmentType } from '../../platform/interpreter/helpers';
import type { PythonEnvironmentFilter } from '../../platform/interpreter/filter/filterService';
import type { INotebookPythonEnvironmentService } from '../types';
import { raceTimeout } from '../../platform/common/utils/async';
import { logger } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { Environment, PythonExtension, ResolvedEnvironment } from '@vscode/python-extension';

export async function findPreferredPythonEnvironment(
    notebook: NotebookDocument,
    pythonApi: PythonExtension,
    filter: PythonEnvironmentFilter,
    notebookEnvironment: INotebookPythonEnvironmentService
): Promise<Environment | undefined> {
    // 1. Check if we have a .conda or .venv virtual env in the local workspace folder.
    const localEnv = findPythonEnvironmentClosestToNotebook(
        notebook,
        pythonApi.environments.known.filter((e) => !filter.isPythonEnvironmentExcluded(e))
    );
    if (localEnv) {
        logger.trace(
            `For ${getDisplayPath(notebook.uri)} found local Python environment: ${getDisplayPath(localEnv.path)}`
        );
        return localEnv;
    }

    // We never want to recommend even using the active interpreter.
    // Its possible the active interpreter is global and could cause other issues.
    const pythonEnv = notebookEnvironment.getPythonEnvironment(notebook.uri);
    if (pythonEnv) {
        logger.trace(`For ${getDisplayPath(notebook.uri)} found Python environment: ${getDisplayPath(pythonEnv.path)}`);
        return pythonApi.environments.resolveEnvironment(pythonEnv.id);
    }

    // 2. Fall back to the workspace env selected by the user.
    const recommeded = await getRecommendedPythonEnvironment(notebook.uri);
    logger.trace(
        `For ${getDisplayPath(notebook.uri)} found recommeded Python environment: ${getDisplayPath(recommeded?.path)}`
    );
    return recommeded;
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

export function findPythonEnvBelongingToFolder(folder: Uri, pythonEnvs: readonly Environment[]) {
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

export async function getRecommendedPythonEnvironment(uri: Uri): Promise<ResolvedEnvironment | undefined> {
    type RecommededEnvironment =
        | {
              environment: ResolvedEnvironment;
              reason: 'globalUserSelected' | 'workspaceUserSelected' | 'defaultRecommended';
          }
        | undefined;
    try {
        const result = (await raceTimeout(5_000, commands.executeCommand('python.getRecommendedEnvironment', uri))) as
            | RecommededEnvironment
            | undefined;
        if (!result) {
            logger.trace(`No recommended Python environment found for ${getDisplayPath(uri)}`);
            return;
        }
        logger.trace(
            `Got a recommended Python environment for ${getDisplayPath(uri)}, ${result.reason} and ${getDisplayPath(
                result.environment?.path
            )}`
        );
        if (result.reason === 'workspaceUserSelected') {
            return result.environment;
        }

        // In dev containers give preference to the global user selected environment.
        // This is because the global user selected environment is the one that is most likely pre-configured in the dev container.
        // Generally the images have the settings already pre-configured with this global env pre-selected.
        // However if there are no workspace folders, then we should use the global user selected environment.
        if (
            result.reason === 'globalUserSelected' &&
            (!workspace.workspaceFolders?.length || env.remoteName === 'dev-container')
        ) {
            return result.environment;
        }

        // Its possible we're in a dev container and the workspace & global env is not selected.
        // However the python.defaultInterprerterPath is set to a path in the dev container.
        // If thats the same as the one we get, then we should use that.
        const defaultInterpreterPath = workspace
            .getConfiguration('python')
            .get<string | undefined>('defaultInterpreterPath', undefined);
        if (env.remoteName === 'dev-container' && defaultInterpreterPath) {
            try {
                let env: ResolvedEnvironment | undefined = result.environment;
                if (env.path !== defaultInterpreterPath) {
                    const api = await PythonExtension.api();
                    env = await api.environments.resolveEnvironment(defaultInterpreterPath);
                }
                if (env && env.path === defaultInterpreterPath) {
                    logger.trace(
                        `Using the default interpreter path ${defaultInterpreterPath} as the recommended Python environment`
                    );
                    return env;
                }
            } catch {
                //
            }
        }
    } catch (ex) {
        return;
    }
}
