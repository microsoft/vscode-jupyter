// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable no-console, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from '../platform/vscode-path/path';

process.env.CODE_TESTS_WORKSPACE = path.join(__dirname, '..', '..', 'src', 'test');
process.env.IS_CI_SERVER_TEST_DEBUGGER = '';
process.env.VSC_JUPYTER_LANGUAGE_SERVER = '1';
process.env.TEST_FILES_SUFFIX = 'ls.test';

function start() {
    console.log('*'.repeat(100));
    console.log('Start language server tests');
    require('../../node_modules/vscode/bin/test');
}
start();
