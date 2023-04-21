// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from './vscode-path/path';

const webpacked = !path.basename(__dirname).includes('platform');

export const EXTENSION_ROOT_DIR = webpacked ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');

export * from './constants';
