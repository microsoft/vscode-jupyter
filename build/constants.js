// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const util = require('./util');
exports.ExtensionRootDir = util.ExtensionRootDir;
exports.isWindows = /^win/.test(process.platform);
exports.isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';
