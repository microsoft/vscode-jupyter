// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// Note to editors, if you change this file you have to restart compile-webviews.
// It doesn't reload the config otherwise.
const common = require('./common');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const constants = require('../constants');
const configFileName = 'tsconfig.datascience-ui.json';
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// Any build on the CI is considered production mode.
const isProdBuild = constants.isCI || process.argv.includes('--mode');
const fasterCompiler = !!process.env.CI_JUPYTER_FAST_COMPILATION;

function getEntry(bundle) {
    switch (bundle) {
        case 'viewers':
            return {
                plotViewer: ['babel-polyfill', `./src/datascience-ui/plot/index.tsx`],
                dataExplorer: ['babel-polyfill', `./src/datascience-ui/data-explorer/index.tsx`],
                variableView: ['babel-polyfill', `./src/datascience-ui/variable-view/index.tsx`]
            };
        case 'ipywidgetsKernel':
            return {
                ipywidgetsKernel: [`./src/datascience-ui/ipywidgets/kernel/index.ts`]
            };
        case 'ipywidgetsRenderer':
            // This is only used in tests (not shipped with extension).
            return {
                ipywidgetsRenderer: [`./src/datascience-ui/ipywidgets/renderer/index.ts`]
            };
        case 'errorRenderer':
            return {
                errorRenderer: [`./src/datascience-ui/error-renderer/index.ts`]
            };
        case 'widgetTester':
            return {
                widgetTester: [`./src/test/datascience/widgets/rendererUtils.ts`]
            };
        default:
            throw new Error(`Bundle not supported ${bundle}`);
    }
}

function getPlugins(bundle) {
    const plugins = [];
    // Add the Fork TS type checker only if we need a fast compilation.
    // When running tests, we'll ignore type checking (faster).
    // Other CI jobs can look for ts issues.
    if (!fasterCompiler) {
        new ForkTsCheckerWebpackPlugin({
            typescript: {
                configFile: configFileName,
                reportFiles: ['src/datascience-ui/**/*.{ts,tsx}'],
                memoryLimit: 9096
            }
        });
    }
    if (isProdBuild) {
        plugins.push(...common.getDefaultPlugins(bundle));
    }
    const definePlugin = new webpack.DefinePlugin({
        process: {
            env: {
                NODE_ENV: JSON.stringify(isProdBuild ? 'production' : 'development')
            }
        }
    });
    switch (bundle) {
        case 'viewers': {
            plugins.push(
                ...[definePlugin],
                ...[
                    new HtmlWebpackPlugin({
                        template: 'src/datascience-ui/plot/index.html',
                        indexUrl: `${constants.ExtensionRootDir}/out/1`,
                        chunks: ['commons', 'plotViewer'],
                        filename: 'index.plotViewer.html'
                    }),
                    new HtmlWebpackPlugin({
                        template: 'src/datascience-ui/data-explorer/index.html',
                        indexUrl: `${constants.ExtensionRootDir}/out/1`,
                        chunks: ['commons', 'dataExplorer'],
                        filename: 'index.dataExplorer.html'
                    }),
                    new HtmlWebpackPlugin({
                        template: 'src/datascience-ui/variable-view/index.html',
                        indexUrl: `${constants.ExtensionRootDir}/out/1`,
                        chunks: ['commons', 'variableView'],
                        filename: 'index.variableView.html'
                    })
                ]
            );
            break;
        }
        case 'widgetTester': {
            plugins.push(definePlugin);
            break;
        }
        case 'ipywidgetsKernel':
        case 'ipywidgetsRenderer':
        case 'errorRenderer': {
            plugins.push(definePlugin);
            break;
        }
        default:
            throw new Error(`Bundle not supported ${bundle}`);
    }

    return plugins;
}

function buildConfiguration(bundle) {
    // console.error(`Bundle = ${ bundle }`);
    // Folder inside `datascience-ui` that will be created and where the files will be dumped.
    const bundleFolder = bundle;
    const filesToCopy = [];
    if (bundle === 'ipywidgetsRenderer') {
        // Include files only for notebooks.
        filesToCopy.push(
            ...[
                {
                    from: 'node_modules/font-awesome/**/*',
                    context: './',
                    to: path.join(constants.ExtensionRootDir, 'out', 'fontAwesome')
                },
                {
                    from: path.join(
                        constants.ExtensionRootDir,
                        'src',
                        'client',
                        'datascience',
                        'notebook',
                        'fontAwesomeLoader.js'
                    ),
                    to: path.join(constants.ExtensionRootDir, 'out', 'fontAwesome')
                }
            ]
        );
    }
    if (bundle === 'ipywidgetsRenderer' || bundle === 'ipywidgetsKernel') {
        filesToCopy.push({
            from: path.join(constants.ExtensionRootDir, 'src/datascience-ui/ipywidgets/kernel/require.js'),
            to: path.join(constants.ExtensionRootDir, 'out', 'datascience-ui', 'ipywidgetsKernel')
        });
    } else if (bundle === 'widgetTester') {
        ///
    } else {
        filesToCopy.push({
            from: path.join(constants.ExtensionRootDir, 'node_modules/requirejs/require.js'),
            to: path.join(constants.ExtensionRootDir, 'out', 'datascience-ui', bundleFolder)
        });
    }
    const plugins = [
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 100
        }),
        ...getPlugins(bundle)
    ];
    if (filesToCopy.length > 0) {
        plugins.push(
            new CopyWebpackPlugin({
                patterns: [...filesToCopy]
            })
        );
    }
    return {
        context: constants.ExtensionRootDir,
        entry: getEntry(bundle),
        cache: true,
        experiments: {
            outputModule: true
        },
        output: {
            path: path.join(constants.ExtensionRootDir, 'out', 'datascience-ui', bundleFolder),
            filename: '[name].js',
            library: {
                type: 'module'
            },
            chunkFilename: `[name].bundle.js`,
            pathinfo: false
        },
        mode: isProdBuild ? 'production' : 'development', // Leave as is, we'll need to see stack traces when there are errors.
        devtool: isProdBuild ? undefined : 'inline-source-map',
        optimization: undefined,
        plugins,
        externals: ['log4js'],
        resolve: {
            // Add '.ts' and '.tsx' as resolvable extensions.
            extensions: ['.ts', '.tsx', '.js', '.json', '.svg'],
            fallback: {
                fs: false,
                path: require.resolve('path-browserify'),
                os: false
            }
        },

        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: [
                        {
                            loader: 'thread-loader',
                            options: {
                                // there should be 1 cpu for the fork-ts-checker-webpack-plugin
                                workers: require('os').cpus().length - 1,
                                workerNodeArgs: ['--max-old-space-size=9096'],
                                poolTimeout: isProdBuild ? 1000 : Infinity // set this to Infinity in watch mode - see https://github.com/webpack-contrib/thread-loader
                            }
                        },
                        {
                            loader: 'ts-loader',
                            options: {
                                happyPackMode: true, // IMPORTANT! use happyPackMode mode to speed-up compilation and reduce errors reported to webpack
                                configFile: configFileName,
                                // Faster (turn on only on CI, for dev we don't need this).
                                transpileOnly: true,
                                silent: true,
                                compilerOptions: {
                                    skipLibCheck: true
                                },
                                reportFiles: ['src/datascience-ui/**/*.{ts,tsx}']
                            }
                        }
                    ]
                },
                {
                    test: /\.svg$/,
                    use: ['thread-loader', 'svg-inline-loader']
                },
                {
                    test: /\.css$/,
                    use: ['thread-loader', 'style-loader', 'css-loader']
                },
                {
                    test: /\.js$/,
                    include: /node_modules.*remark.*default.*js/,
                    use: [
                        'thread-loader',
                        {
                            loader: path.resolve('./build/webpack/loaders/remarkLoader.js'),
                            options: {}
                        }
                    ]
                },
                {
                    test: /\.json$/,
                    type: 'javascript/auto',
                    include: /node_modules.*remark.*/,
                    use: [
                        'thread-loader',
                        {
                            loader: path.resolve('./build/webpack/loaders/jsonloader.js'),
                            options: {}
                        }
                    ]
                },
                {
                    test: /\.(png|woff|woff2|eot|gif|ttf)$/,
                    type: 'asset/inline'
                },
                {
                    test: /\.less$/,
                    use: ['thread-loader', 'style-loader', 'css-loader', 'less-loader']
                },
                {
                    test: require.resolve('slickgrid/lib/jquery-1.11.2.min'),
                    loader: 'expose-loader',
                    options: {
                        exposes: {
                            globalName: 'jQuery',
                            override: true
                        }
                    }
                },
                {
                    test: require.resolve('slickgrid/lib/jquery.event.drag-2.3.0'),
                    loader: 'expose-loader',
                    options: {
                        exposes: {
                            globalName: 'jQuery.fn.drag',
                            override: true
                        }
                    }
                }
            ]
        }
    };
}

exports.viewers = buildConfiguration('viewers');
exports.ipywidgetsKernel = buildConfiguration('ipywidgetsKernel');
exports.ipywidgetsRenderer = buildConfiguration('ipywidgetsRenderer');
exports.errorRenderer = buildConfiguration('errorRenderer');
exports.widgetTester = buildConfiguration('widgetTester');
