// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

const common = require('./common');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const constants = require('../constants');
const configFileName = 'tsconfig.datascience-ui.json';
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// Any build on the CI is considered production mode.
const isProdBuild = constants.isCI || process.argv.includes('--mode');
const isWatchMode = process.argv.includes('--watch');
const fasterCompiler = !!process.env.CI_JUPYTER_FAST_COMPILATION;

function getEntry(bundle) {
    switch (bundle) {
        case 'viewers':
            return {
                plotViewer: ['babel-polyfill', `./src/webviews/webview-side/plot/index.tsx`],
                dataExplorer: ['babel-polyfill', `./src/webviews/webview-side/data-explorer/index.tsx`],
                variableView: ['babel-polyfill', `./src/webviews/webview-side/variable-view/index.tsx`]
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
                reportFiles: ['src/webviews/webview-side/**/*.{ts,tsx}'],
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
        },
        BROWSER: JSON.stringify(true) // All UI pieces are running in the browser
    });
    switch (bundle) {
        case 'viewers': {
            plugins.push(
                ...[definePlugin],
                ...[
                    new HtmlWebpackPlugin({
                        template: 'src/webviews/webview-side/plot/index.html',
                        indexUrl: `${constants.ExtensionRootDir}/out/1`,
                        chunks: ['commons', 'plotViewer'],
                        filename: 'index.plotViewer.html'
                    }),
                    new HtmlWebpackPlugin({
                        template: 'src/webviews/webview-side/data-explorer/index.html',
                        indexUrl: `${constants.ExtensionRootDir}/out/1`,
                        chunks: ['commons', 'dataExplorer'],
                        filename: 'index.dataExplorer.html'
                    }),
                    new HtmlWebpackPlugin({
                        template: 'src/webviews/webview-side/variable-view/index.html',
                        indexUrl: `${constants.ExtensionRootDir}/out/1`,
                        chunks: ['commons', 'variableView'],
                        filename: 'index.variableView.html'
                    })
                ]
            );
            break;
        }
        default:
            throw new Error(`Bundle not supported ${bundle}`);
    }

    return plugins;
}

function buildConfiguration(bundle) {
    // console.error(`Bundle = ${ bundle }`);
    // Folder inside `webviews/webview-side` that will be created and where the files will be dumped.
    const bundleFolder = bundle;
    const plugins = [
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 100
        }),
        ...getPlugins(bundle)
    ];
    return {
        context: constants.ExtensionRootDir,
        entry: getEntry(bundle),
        cache: true,
        experiments: {
            outputModule: true
        },
        output: {
            path: path.join(constants.ExtensionRootDir, 'out', 'webviews/webview-side', bundleFolder),
            filename: '[name].js',
            library: {
                type: 'module'
            },
            chunkFilename: `[name].bundle.js`,
            pathinfo: false,
            publicPath: 'built/'
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
                                poolTimeout: isWatchMode ? Infinity : 1000 // set this to Infinity in watch mode - see https://github.com/webpack-contrib/thread-loader
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
                                reportFiles: ['src/webviews/webview-side/**/*.{ts,tsx}']
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
