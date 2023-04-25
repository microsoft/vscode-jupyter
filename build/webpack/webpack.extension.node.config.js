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
const configFileName = path.join(constants.ExtensionRootDir, 'src/tsconfig.extension.node.json');
// Some modules will be pre-generated and stored in out/.. dir and they'll be referenced via NormalModuleReplacementPlugin
// We need to ensure they do not get bundled into the output (as they are large).
const existingModulesInOutDir = common.getListOfExistingModulesInOutDir();

function shouldCopyFileFromZmqFolder(parentFolder, resourcePath) {
    const fileName = path.basename(resourcePath);
    resourcePath = (resourcePath || '').toString().toLowerCase().replace('\\', '/');
    // We do not need to bundle these folders
    const foldersToIgnore = ['build', 'script', 'src', 'node_modules', 'vendor'];
    if (
        foldersToIgnore.some((folder) =>
            resourcePath.toLowerCase().startsWith(path.join(parentFolder, folder).replace('\\', '/').toLowerCase())
        )
    ) {
        console.log('Ignore file (1)', resourcePath);
        return false;
    }

    if (
        resourcePath.endsWith('.js') ||
        resourcePath.endsWith('.json') ||
        resourcePath.endsWith('.md') ||
        resourcePath.endsWith('license')
    ) {
        return true;
    }
    if (!resourcePath.includes(path.join(parentFolder, 'prebuilds').replace('\\', '/').toLowerCase())) {
        // We do not ship any other sub directory.
        console.log(
            'Ignore file (2)',
            `Not includes ${path.join(parentFolder, 'prebuilds').replace('\\', '/').toLowerCase()}`,
            resourcePath
        );
        return false;
    }
    if (filename.includes('electron.') && resourcePath.endsWith('.node')) {
        // We do not ship electron binaries.
        console.log('Ignore file (3)', resourcePath);
        return false;
    }
    const preBuildsFoldersToCopy = common.getZeroMQPreBuildsFoldersToKeep();
    if (preBuildsFoldersToCopy.length === 0) {
        // Copy everything from all prebuilds folder.
        return true;
    }
    // Copy if this is a prebuilds folder that needs to be copied across.
    // Use path.sep as the delimiter, as we do not want linux-arm64 to get compiled with search criteria is linux-arm.
    if (preBuildsFoldersToCopy.some((folder) => resourcePath.includes(`${folder.toLowerCase()}/`))) {
        return true;
    }
    console.log('Ignore file (6)', resourcePath);
    return false;
}
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
                            configFile: 'src/tsconfig.extension.node.json'
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
    externals: [
        'vscode',
        'commonjs',
        'electron',
        './node_modules/zeromq',
        './node_modules/zeromqold',
        './node_modules/@vscode/jupyter-ipywidgets7',
        ...existingModulesInOutDir,
        '@opentelemetry/tracing',
        // Ignore telemetry specific packages that are not required.
        'applicationinsights-native-metrics',
        '@azure/functions-core',
        '@azure/opentelemetry-instrumentation-azure-sdk',
        '@opentelemetry/instrumentation'
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
        new removeFilesWebpackPlugin({ after: { include: ['./out/node_modules/zeromqold.js'], log: false } }),
        new copyWebpackPlugin({
            patterns: [
                // Copy files from latest zmq package.
                { from: './node_modules/@aminya/node-gyp-build/**/*' },
                {
                    from: './node_modules/zeromq/**/*',
                    filter: (filepath) =>
                        shouldCopyFileFromZmqFolder(
                            path.join(constants.ExtensionRootDir, 'node_modules', 'zeromq'),
                            filepath
                        )
                }
            ]
        }),
        new copyWebpackPlugin({
            patterns: [
                // Copy files from fallback zmq package.
                {
                    from: './node_modules/zeromqold/**/*',
                    filter: (filepath) =>
                        shouldCopyFileFromZmqFolder(
                            path.join(constants.ExtensionRootDir, 'node_modules', 'zeromqold'),
                            filepath
                        )
                },
                { from: './node_modules/node-gyp-build/**/*' }
            ]
        }),
        new webpack.DefinePlugin({
            IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION: JSON.stringify(
                typeof process.env.IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION === 'string'
                    ? process.env.IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION
                    : 'true'
            )
        })
    ],
    resolve: {
        alias: {
            // Pointing pdfkit to a dummy js file so webpack doesn't fall over.
            // Since pdfkit has been externalized (it gets updated with the valid code by copying the pdfkit files
            // into the right destination).
            pdfkit: path.resolve(__dirname, 'pdfkit.js'),
            moment: path.join(__dirname, 'moment.js')
        },
        extensions: ['.ts', '.js'],
        plugins: [new tsconfig_paths_webpack_plugin.TsconfigPathsPlugin({ configFile: configFileName })],
        fallback: {
            util: require.resolve('util/')
        }
    },
    // Uncomment this to not minify chunk file names to easily identify them
    // optimization: {
    //     chunkIds: 'named'
    // },
    output: {
        filename: '[name].node.js',
        path: path.resolve(constants.ExtensionRootDir, 'out'),
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../../[resource-path]'
    }
};
// tslint:disable-next-line:no-default-export
exports.default = config;
