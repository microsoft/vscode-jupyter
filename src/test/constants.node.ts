// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../platform/vscode-path/path';
import { setCI, setTestExecution, setUnitTestExecution } from '../platform/common/constants';
import { setTestSettings } from './constants';
export * from './constants';

// Activating extension for Multiroot and Debugger CI tests for Windows takes just over 2 minutes sometimes, so 3 minutes seems like a safe margin

export const EXTENSION_ROOT_DIR_FOR_TESTS = path.join(__dirname, '..', '..');
export const EXTENSION_TEST_DIR_FOR_FILES = path.join(
    EXTENSION_ROOT_DIR_FOR_TESTS,
    'src',
    'test',
    'datascience',
    'temp'
);
export const JVSC_EXTENSION_ID_FOR_TESTS = 'ms-toolsai.jupyter';

export const SMOKE_TEST_EXTENSIONS_DIR = path.join(
    EXTENSION_ROOT_DIR_FOR_TESTS,
    'temp',
    'ext',
    'smokeTestExtensionsFolder'
);

// Have to set these values in a '.node' based file.
setCI(process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true');
setTestExecution(process.env.VSC_JUPYTER_CI_TEST === '1');
setUnitTestExecution(process.env.VSC_JUPYTER_UNIT_TEST === '1');
setTestSettings({
    isSmokeTest: process.env.VSC_JUPYTER_SMOKE_TEST === '1',
    isCIServer: process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true',
    isCIServerTestDebuggable: process.env.IS_CI_SERVER_TEST_DEBUGGER === '1',
    isCondaTest: (process.env.VSC_JUPYTER_CI_IS_CONDA || '').toLowerCase() === 'true',
    isNonRawNativeTest: (process.env.VSC_JUPYTER_NON_RAW_NATIVE_TEST || '').toLowerCase() === 'true',
    isRemoteNativeTest: (process.env.VSC_JUPYTER_REMOTE_NATIVE_TEST || '').toLowerCase() === 'true',
    isPerfTest: process.env.VSC_JUPYTER_PERF_TEST === '1'
});
