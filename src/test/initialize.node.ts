// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../platform/vscode-path/path';
import * as vscode from 'vscode';
import { IExtensionTestApi, PYTHON_PATH, setPythonPathInWorkspaceRoot, initializeCommonNodeApi } from './common.node';
import { IS_SMOKE_TEST } from './constants.node';
import { startJupyterServer } from './datascience/notebook/helper.node';
import { PythonExtension, setTestExecution } from '../platform/common/constants';
import { activateExtension, closeActiveWindows } from './initialize';

export * from './initialize';
export * from './constants.node';
export * from './ciConstants.node';
export const multirootPath = path.join(__dirname, '..', '..', 'src', 'test', 'testMultiRootWkspc');

//First thing to be executed.
process.env.VSC_JUPYTER_CI_TEST = '1';
setTestExecution(true);

// Ability to use custom python environments for testing
export async function initializePython() {
    initializeCommonNodeApi();
    await setPythonPathInWorkspaceRoot(PYTHON_PATH);
    // Make sure the python extension can load if this test allows it
    if (!process.env.VSC_JUPYTER_CI_TEST_DO_NOT_INSTALL_PYTHON_EXT) {
        const extension = vscode.extensions.getExtension(PythonExtension);
        if (!extension) {
            console.error('Python extension not found');
            throw new Error('Python extension not found');
        }
        await extension.activate();
    }
}

let jupyterServerStarted = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initialize(): Promise<IExtensionTestApi> {
    await initializePython();
    initializeCommonNodeApi();
    const api = (await activateExtension()) as IExtensionTestApi;
    // Ensure we start jupyter server before opening any notebooks or the like.
    if (!jupyterServerStarted) {
        jupyterServerStarted = true;
        await startJupyterServer();
    }
    return api;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initializeTest(): Promise<any> {
    await initializePython();
    await closeActiveWindows();
    if (!IS_SMOKE_TEST()) {
        // When running smoke tests, we won't have access to these.
        const configSettings = await import('../platform/common/configSettings');
        // Dispose any cached python settings (used only in test env).
        configSettings.JupyterSettings.dispose();
    }
}
