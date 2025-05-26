// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IBaseToolParams, selectKernelAndStart } from './helper';
import { PythonExtension as PythonExtensionId } from '../../platform/common/constants';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import {
    CancellationToken,
    extensions,
    LanguageModelToolInvocationOptions,
    lm,
    NotebookDocument,
    Uri,
    workspace
} from 'vscode';
import { raceCancellationError } from '../../platform/common/cancellation';
import { logger } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { Environment, PythonExtension } from '@vscode/python-extension';
import { dirname, isEqual } from '../../platform/vscode-path/resources';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { sleep } from '../../platform/common/utils/async';

const PYTHON_VIRTUAL_ENV_TOOL_NAME = 'create_virtual_environment';

export async function createVirtualEnvAndSelectAsKernel(
    options: LanguageModelToolInvocationOptions<IBaseToolParams>,
    notebook: NotebookDocument,
    controllerRegistration: IControllerRegistration,
    token: CancellationToken
) {
    const shoudlCreateVenv = await shouldCreateVirtualEnvForNotebook(notebook, token);
    if (!shoudlCreateVenv) {
        // This tool should not have been invoked if there is no workspace folder.
        // or if the tool isn't available for use.
        return false;
    }

    const api = await raceCancellationError(token, PythonExtension.api());
    const input = { resourcePath: notebook.uri.fsPath };
    await lm.invokeTool(PYTHON_VIRTUAL_ENV_TOOL_NAME, { ...options, input }, token);

    logger.trace(`Create Env tool for notebook ${getDisplayPath(notebook.uri)}`);

    const env = getWorkspaceVenvOrCondaEnv(notebook.uri, api.environments);
    if (!env) {
        logger.error(`Create Env tool for notebook ${getDisplayPath(notebook.uri)} but no virtual environment found`);
        return false;
    }

    const resolvedEnv = await api.environments.resolveEnvironment(env);
    logger.trace(`Invoked Create Env tool for notebook ${getDisplayPath(notebook.uri)} and got env ${resolvedEnv?.id}`);
    if (!resolvedEnv) {
        logger.error(
            `Invoked Create Env tool for notebook ${getDisplayPath(
                notebook.uri
            )} but no resolved env for ${getDisplayPath(env?.id)}`
        );
        return false;
    }

    let preferredController = controllerRegistration.all.find(
        (c) => c.kind === 'startUsingPythonInterpreter' && c.interpreter.id === resolvedEnv.id
    );
    const stopWatch = new StopWatch();
    // Lets wait for controller to get registered
    while (stopWatch.elapsedTime < 1_000 && !preferredController) {
        preferredController = controllerRegistration.all.find(
            (c) => c.kind === 'startUsingPythonInterpreter' && c.interpreter.id === resolvedEnv.id
        );
        await sleep(100);
    }

    if (!preferredController) {
        logger.error(
            `Invoked Create Env toolfor notebook ${getDisplayPath(
                notebook.uri
            )} and got env ${resolvedEnv?.id}, but no controller found for it`
        );
        return false;
    }

    logger.trace(
        `ConfigurePythonNotebookTool: Selecting recommended Python Env for notebook ${getDisplayPath(notebook.uri)}`
    );
    // Lets not start just yet, as dependencies will be missing.
    await selectKernelAndStart(notebook, preferredController, controllerRegistration, token, false);
    return true;
}

export async function shouldCreateVirtualEnvForNotebook(
    notebook: NotebookDocument,
    token: CancellationToken
): Promise<boolean> {
    if (!extensions.getExtension(PythonExtensionId)) {
        return false;
    }

    const workspaceFolder =
        workspace.getWorkspaceFolder(notebook.uri) ||
        (workspace.workspaceFolders?.length === 1 ? workspace.workspaceFolders[0] : undefined);

    if (!workspaceFolder) {
        return false;
    }

    if (!extensions.getExtension(PythonExtensionId)) {
        return false;
    }
    const api = await raceCancellationError(token, PythonExtension.api());

    return !getWorkspaceVenvOrCondaEnv(notebook.uri, api.environments);
}

function getWorkspaceVenvOrCondaEnv(resource: Uri | undefined, api: PythonExtension['environments']) {
    const workspaceFolder =
        resource && workspace.workspaceFolders?.length
            ? workspace.getWorkspaceFolder(resource)
            : workspace.workspaceFolders?.length === 1
            ? workspace.workspaceFolders[0]
            : undefined;
    if (!workspaceFolder) {
        return;
    }
    const isVenvEnv = (env: Environment) => {
        return (
            env.environment?.folderUri &&
            env.executable.sysPrefix &&
            isEqual(dirname(Uri.file(env.executable.sysPrefix)), workspaceFolder.uri) &&
            env.environment.name === '.venv' &&
            env.environment.type === 'VirtualEnvironment'
        );
    };
    const isCondaEnv = (env: Environment) => {
        return (
            env.environment?.folderUri &&
            env.executable.sysPrefix &&
            isEqual(dirname(Uri.file(env.executable.sysPrefix)), workspaceFolder.uri) &&
            isEqual(env.environment.folderUri, Uri.joinPath(workspaceFolder.uri, '.conda')) &&
            env.environment.type === 'Conda'
        );
    };
    // If we alraedy have a .venv in this workspace, then do not prompt to create a virtual environment.
    return api.known.find((e) => isVenvEnv(e) || isCondaEnv(e));
}
