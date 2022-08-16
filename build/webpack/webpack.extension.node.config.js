// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const webpack = require('webpack');
const copyWebpackPlugin = require('copy-webpack-plugin');
const removeFilesWebpackPlugin = require('remove-files-webpack-plugin');
const path = require('path');
const tsconfig_paths_webpack_plugin = require('tsconfig-paths-webpack-plugin');
const constants = require('../constants');
const common = require('./common');
// tslint:disable-next-line:no-var-requires no-require-imports
const configFileName = path.join(constants.ExtensionRootDir, 'tsconfig.extension.node.json');
// Some modules will be pre-genearted and stored in out/.. dir and they'll be referenced via NormalModuleReplacementPlugin
// We need to ensure they do not get bundled into the output (as they are large).
const existingModulesInOutDir = common.getListOfExistingModulesInOutDir();
const config = {
    mode: 'production',
    target: 'node',
    entry: {
        extension: './src/extension.node.ts'
    },
    devtool: 'source-map',
    node: {
        __dirname: false
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
                    ...(process.env.BUILD_WITH_VSCODE_NLS
                        ? [
                              {
                                  loader: 'vscode-nls-dev/lib/webpack-loader',
                                  options: {
                                      base: constants.ExtensionRootDir
                                  }
                              }
                          ]
                        : []),
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
                        loader: 'ts-loader'
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
    externals: [
        'vscode',
        'commonjs',
        'electron',
        './node_modules/zeromq',
        './node_modules/@vscode/jupyter-ipywidgets',
        ...existingModulesInOutDir,
        '@opentelemetry/tracing',
        'applicationinsights-native-metrics'
    ], // Don't bundle these
    plugins: [
        ...common.getDefaultPlugins('extension'),
        new copyWebpackPlugin({
            patterns: [
                {
                    from: './node_modules/pdfkit/js/pdfkit.standalone.js',
                    to: './node_modules/pdfkit/js/pdfkit.standalone.js'
                }
            ]
        }),
        new copyWebpackPlugin({
            patterns: [
                {
                    from: './node_modules/jquery/dist/jquery.min.js',
                    to: './node_modules/jquery/dist/jquery.min.js'
                }
            ]
        }),
        // ZMQ requires prebuilds to be in our node_modules directory. So recreate the ZMQ structure.
        // However we don't webpack to manage this, so it was part of the excluded modules. Delete it from there
        // so at runtime we pick up the original structure.
        new removeFilesWebpackPlugin({ after: { include: ['./out/node_modules/zeromq.js'], log: false } }),
        new copyWebpackPlugin({ patterns: [{ from: './node_modules/zeromq/**/*.js' }] }),
        new copyWebpackPlugin({ patterns: [{ from: './node_modules/zeromq/**/*.node' }] }),
        new copyWebpackPlugin({ patterns: [{ from: './node_modules/zeromq/**/*.json' }] }),
        new copyWebpackPlugin({ patterns: [{ from: './node_modules/node-gyp-build/**/*' }] }),
        new copyWebpackPlugin({ patterns: [{ from: './node_modules/@vscode/jupyter-ipywidgets/dist/*.js' }] }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^\.\/locale$/,
            contextRegExp: /moment$/
        })
    ],
    resolve: {
        alias: {
            // Pointing pdfkit to a dummy js file so webpack doesn't fall over.
            // Since pdfkit has been externalized (it gets updated with the valid code by copying the pdfkit files
            // into the right destination).
            pdfkit: path.resolve(__dirname, 'pdfkit.js')
        },
        extensions: ['.ts', '.js'],
        plugins: [new tsconfig_paths_webpack_plugin.TsconfigPathsPlugin({ configFile: configFileName })],
        fallback: {
            util: require.resolve('util/')
        }
    },
    output: {
        filename: '[name].node.js',
        path: path.resolve(constants.ExtensionRootDir, 'out'),
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../../[resource-path]'
    }
};
// tslint:disable-next-line:no-default-export
exports.default = config;
