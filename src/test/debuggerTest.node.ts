// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable no-console */

import * as path from '../platform/vscode-path/path';
import { runTests } from '@vscode/test-electron';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants.node';

const workspacePath = path.join(__dirname, '..', '..', 'src', 'test', 'testMultiRootWkspc', 'multi.code-workspace');
process.env.IS_CI_SERVER_TEST_DEBUGGER = '1';
process.env.VSC_JUPYTER_CI_TEST = '1';

function start() {
    console.log('*'.repeat(100));
    console.log('Start Debugger tests');
    runTests({
        extensionDevelopmentPath: EXTENSION_ROOT_DIR_FOR_TESTS,
        extensionTestsPath: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'out', 'test', 'index'),
        launchArgs: [workspacePath],
        version: 'stable',
        extensionTestsEnv: { ...process.env, DISABLE_INSIDERS_EXTENSION: '1' }
    }).catch((ex) => {
        console.error('End Debugger tests (with errors)', ex);
        process.exit(1);
    });
}
start();
