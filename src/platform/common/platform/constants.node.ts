// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line
// TODO : Drop all these in favor of IPlatformService.
// See https://github.com/microsoft/vscode-python/issues/8542.

export const WINDOWS_PATH_VARIABLE_NAME = 'Path';
export const NON_WINDOWS_PATH_VARIABLE_NAME = 'PATH';
export const IS_WINDOWS = /^win/.test(process.platform);
