// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from 'path';

const webpacked = !path.basename(__dirname).includes('platform');

export const EXTENSION_ROOT_DIR = webpacked ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');

export const HiddenFileFormatString = '_HiddenFile_{0}.py';

export const MillisecondsInADay = 24 * 60 * 60 * 1_000;
