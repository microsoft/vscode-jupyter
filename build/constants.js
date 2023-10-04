// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const path = require('path');
exports.ExtensionRootDir = path.dirname(__dirname);
exports.isWindows = /^win/.test(process.platform);
exports.isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';
