// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

const path = require('path');
const tsconfig_paths_webpack_plugin = require('tsconfig-paths-webpack-plugin');
const webpack = require('webpack');
const constants = require('../constants');
// tslint:disable-next-line:no-var-requires no-require-imports
const configFileName = path.join(constants.ExtensionRootDir, 'tsconfig.extension.web.json');
const config = {
    mode: 'none',
    target: 'webworker',
    entry: {
        extension: './src/extension.web.ts',
        'test/vscode.test/index': './src/test/web/vscode.test/index.ts', // source of the web extension test runner
        'test/smoke.test/index': './src/test/web/smoke.test/index.ts' // source of the web extension test runner
    },
    devtool: 'nosources-source-map', // create a source map that points to the original source file
    node: {
        __dirname: false,
        __filename: false
    },
    module: {
        rules: [
            {
                // JupyterServices imports node-fetch.
                test: /@jupyterlab[\\\/]services[\\\/].*js$/,
                use: [
                    {
                        loader: path.join(__dirname, 'loaders', 'fixNodeFetch.js')
                    }
                ]
            },
            {
                test: /\.ts$/,
                use: [
                    {
                        loader: path.join(__dirname, 'loaders', 'externalizeDependencies.js')
                    }
                ]
            },
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'tsconfig.extension.web.json'
                        }
                    }
                ]
            },
            {
                enforce: 'post',
                test: /unicode-properties[\/\\]index.js$/,
                use: [
                    {
                        loader: 'transform-loader',
                        options: {
                            brfs: true
                        }
                    }
                ]
            },
            {
                enforce: 'post',
                test: /fontkit[\/\\]index.js$/,
                use: [
                    {
                        loader: 'transform-loader',
                        options: {
                            brfs: true
                        }
                    }
                ]
            },
            {
                enforce: 'post',
                test: /linebreak[\/\\]src[\/\\]linebreaker.js/,
                use: [
                    {
                        loader: 'transform-loader',
                        options: {
                            brfs: true
                        }
                    }
                ]
            }
        ]
    },
    externals: ['vscode', 'commonjs', 'electron'], // Don't bundle these
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser' // provide a shim for the global `process` variable
        }),
        new webpack.DefinePlugin({
            // Definitions...
            BROWSER: JSON.stringify(true),
            process: {
                platform: 'web'
            }
        })
    ],
    resolve: {
        extensions: ['.ts', '.js'],
        mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
        plugins: [
            new tsconfig_paths_webpack_plugin.TsconfigPathsPlugin({ configFile: configFileName, logLevel: 'INFO' })
        ],
        alias: {
            // provides alternate implementation for node module and source files
        },
        fallback: {
            // Webpack 5 no longer polyfills Node.js core modules automatically.
            // see https://webpack.js.org/configuration/resolve/#resolvefallback
            // for the list of Node.js core module polyfills.
            assert: require.resolve('assert')
        }
    },
    output: {
        filename: '[name].web.bundle.js',
        path: path.resolve(constants.ExtensionRootDir, 'out'),
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]'
    }
};
// tslint:disable-next-line:no-default-export
exports.default = config;
