// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

//
// Constants that pertain to CI processes/tests only. No dependencies on vscode!
//
const IS_VSTS = process.env.TF_BUILD !== undefined;
const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
export const IS_CI_SERVER = IS_VSTS || IS_GITHUB_ACTIONS;

// Control JUnit-style output logging for reporting purposes.
let reportJunit: boolean = false;
if (IS_CI_SERVER && process.env.MOCHA_REPORTER_JUNIT !== undefined) {
    reportJunit = process.env.MOCHA_REPORTER_JUNIT.toLowerCase() === 'true';
}
export const IS_CI_SERVER_TEST_DEBUGGER = process.env.IS_CI_SERVER_TEST_DEBUGGER === '1';
