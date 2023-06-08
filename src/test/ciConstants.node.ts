// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//
// Constants that pertain to CI processes/tests only. No dependencies on vscode!
//
const IS_VSTS = process.env.TF_BUILD !== undefined;
const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
export const IS_CI_SERVER = IS_VSTS || IS_GITHUB_ACTIONS;

export const IS_CI_SERVER_TEST_DEBUGGER = process.env.IS_CI_SERVER_TEST_DEBUGGER === '1';
