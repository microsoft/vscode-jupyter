// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const path = require('path');
const tsconfig_paths_webpack_plugin = require('tsconfig-paths-webpack-plugin');
const webpack = require('webpack');
const constants = require('../constants');
const CleanTerminalPlugin = require('clean-terminal-webpack-plugin');

const devEntry = {
    extension: './src/extension.web.ts'
};
const testEntry = {
    extension: './src/test/web/index.ts' // source of the web extension test runner
};

// When running web tests, the entry point for the tests and extension are the same.
// Also, when building the production VSIX there's no need to compile the tests (faster build pipline).
const entry = process.env.VSC_TEST_BUNDLE === 'true' ? testEntry : devEntry;

// tslint:disable-next-line:no-var-requires no-require-imports
const configFileName = path.join(constants.ExtensionRootDir, 'tsconfig.extension.web.json');
const config = {
    mode: process.env.VSC_TEST_BUNDLE ? 'development' : 'none',
    target: 'webworker',
    entry,
    devtool: 'nosources-source-map', // create a source map that points to the original source file
    node: {
        __dirname: false,
        __filename: false
    },
    module: {
        rules: [
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
                test: /vscode_datascience_helpers.*\.py/,
                exclude: /node_modules/,
                type: 'asset/source'
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
        // Work around for Buffer is undefined:
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer']
        }),
        new webpack.ProvidePlugin({
            process: 'process/browser' // provide a shim for the global `process` variable
        }),
        new webpack.DefinePlugin({
            // Definitions...
            BROWSER: JSON.stringify(true),
            process: {
                platform: JSON.stringify('web')
            }
        }),
        new CleanTerminalPlugin(),
        new webpack.IgnorePlugin({
            resourceRegExp: /^\.\/locale$/,
            contextRegExp: /moment$/
        }),
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1
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
            fs: './fs-empty.js'
        },
        fallback: {
            // Webpack 5 no longer polyfills Node.js core modules automatically.
            // see https://webpack.js.org/configuration/resolve/#resolvefallback
            // for the list of Node.js core module polyfills.
            assert: require.resolve('assert'),
            buffer: require.resolve('buffer'),
            stream: require.resolve('stream-browserify'),
            os: require.resolve('os-browserify'),
            path: require.resolve('path-browserify'),
            fs: false
        }
    },
    output: {
        filename: '[name].web.bundle.js',
        path: path.resolve(constants.ExtensionRootDir, 'out'),
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]'
    },
    watchOptions: {
        aggregateTimeout: 200,
        poll: 1000,
        ignored: /node_modules/
    },
    stats: {
        builtAt: true
    }
};
// tslint:disable-next-line:no-default-export
exports.default = config;
