// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from './vscode-path/path';

// We always use esbuild to bundle the extension,
// Thus __dirname will always be a file in `dist` folder.
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');
export * from './constants';
