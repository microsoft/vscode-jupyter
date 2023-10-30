// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const path = require('path');
const constants = require('../constants');
const common = require('./common');
const entryItems = {
    // jsonc-parser does not get bundled propertly with esbuild.
    [`node_modules/jsonc-parser`]: `./node_modules/jsonc-parser`
};

const config = {
    mode: 'production',
    target: 'node',
    context: constants.ExtensionRootDir,
    entry: entryItems,
    devtool: 'source-map',
    node: {
        __dirname: false
    },
    externals: ['vscode', 'commonjs', 'vscode-jsonrpc'],
    plugins: [...common.getDefaultPlugins('dependencies')],
    resolve: {
        extensions: ['.js']
    },
    output: {
        filename: '[name].js',
        path: path.resolve(constants.ExtensionRootDir, 'out'),
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../../[resource-path]'
    }
};
// tslint:disable-next-line:no-default-export
exports.default = config;
