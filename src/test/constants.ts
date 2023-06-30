// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const JVSC_EXTENSION_ID_FOR_TESTS = 'ms-toolsai.jupyter';

export type TestSettingsType = {
    isSmokeTest: boolean;
    isRemoteNativeTest: boolean;
    isNonRawNativeTest: boolean;
    isCIServer: boolean;
    isCIServerTestDebuggable: boolean;
    isCondaTest: boolean;
    isPerfTest: boolean;
};

let testSettings: TestSettingsType = {
    isSmokeTest: false,
    isRemoteNativeTest: false,
    isNonRawNativeTest: false,
    isCIServer: false,
    isCIServerTestDebuggable: false,
    isCondaTest: false,
    isPerfTest: false
};

export const MAX_EXTENSION_ACTIVATION_TIME = 180_000;
export const TEST_TIMEOUT = 25000;
export const JUPYTER_SERVER_URI = 'TOBEREPLACED_WITHURI';
export const TEST_RETRYCOUNT = 0;
export const SelectJupyterURI = 'jupyter.selectjupyteruri';
export function IS_SMOKE_TEST() {
    return testSettings.isSmokeTest;
}
export function IS_PERF_TEST() {
    return testSettings.isPerfTest;
}
export function IS_REMOTE_NATIVE_TEST() {
    return testSettings.isRemoteNativeTest;
}
export function IS_NON_RAW_NATIVE_TEST() {
    return testSettings.isNonRawNativeTest;
}
export const IS_MULTI_ROOT_TEST = isMultirootTest;
export function IS_CONDA_TEST() {
    return testSettings.isCondaTest;
}

// If running on CI server, then run debugger tests ONLY if the corresponding flag is enabled.
export function TEST_DEBUGGER() {
    return testSettings.isCIServer ? testSettings.isCIServerTestDebuggable : true;
}

function isMultirootTest() {
    // No need to run smoke nor perf tests in a multi-root environment.
    if (IS_SMOKE_TEST() || IS_PERF_TEST()) {
        return false;
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscode = require('vscode');
        const workspace = vscode.workspace;
        return Array.isArray(workspace.workspaceFolders) && workspace.workspaceFolders.length > 1;
    } catch {
        // being accessed, when VS Code hasn't been launched.
        return false;
    }
}

export function setTestSettings(newSettings: Partial<TestSettingsType>) {
    testSettings = { ...testSettings, ...newSettings };
}

export const IPYTHON_VERSION_CODE = 'import IPython\nprint(int(IPython.__version__[0]))\n';
