// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// Note to editors, if you change this file you have to restart compile-webviews.
// It doesn't reload the config otherwise.
const common = require('./common');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const FixDefaultImportPlugin = require('webpack-fix-default-import-plugin');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const constants = require('../constants');
const configFileName = 'tsconfig.datascience-ui.json';
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const EsmWebpackPlugin = require('@purtuga/esm-webpack-plugin');

// Any build on the CI is considered production mode.
const isProdBuild = constants.isCI || process.argv.includes('--mode');
const fasterCompiler = !!process.env.CI_JUPYTER_FAST_COMPILATION;

function getEntry(bundle) {
    switch (bundle) {
        case 'notebook':
            return {
                nativeEditor: ['babel-polyfill', `./src/datascience-ui/native-editor/index.tsx`],
                interactiveWindow: ['babel-polyfill', `./src/datascience-ui/history-react/index.tsx`]
            };
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
            return {
                ipywidgetsRenderer: [`./src/datascience-ui/ipywidgets/renderer/index.ts`]
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
    switch (bundle) {
        case 'notebook':
            plugins.push(
                new MonacoWebpackPlugin({
                    languages: [] // force to empty so onigasm will be used
                }),
                new HtmlWebpackPlugin({
                    template: path.join(__dirname, '/nativeOrInteractivePicker.html'),
                    chunks: [],
                    filename: 'index.html'
                }),
                new HtmlWebpackPlugin({
                    template: 'src/datascience-ui/native-editor/index.html',
                    chunks: ['monaco', 'commons', 'nativeEditor'],
                    filename: 'index.nativeEditor.html'
                }),
                new HtmlWebpackPlugin({
                    template: 'src/datascience-ui/history-react/index.html',
                    chunks: ['monaco', 'commons', 'interactiveWindow'],
                    filename: 'index.interactiveWindow.html'
                })
            );
            break;
        case 'viewers': {
            const definePlugin = new webpack.DefinePlugin({
                'process.env': {
                    NODE_ENV: JSON.stringify('production')
                }
            });

            plugins.push(
                ...(isProdBuild ? [definePlugin] : []),
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
        case 'ipywidgetsRenderer': {
            const definePlugin = new webpack.DefinePlugin({
                'process.env': {
                    NODE_ENV: JSON.stringify('production')
                }
            });

            plugins.push(...(isProdBuild ? [definePlugin] : []));
            plugins.push(new EsmWebpackPlugin());
            break;
        }
        case 'ipywidgetsKernel': {
            const definePlugin = new webpack.DefinePlugin({
                'process.env': {
                    NODE_ENV: JSON.stringify('production')
                }
            });

            plugins.push(...(isProdBuild ? [definePlugin] : []));
            break;
        }
        default:
            throw new Error(`Bundle not supported ${bundle}`);
    }

    return plugins;
}

function buildConfiguration(bundle) {
    // console.error(`Bundle = ${bundle}`);
    // Folder inside `datascience-ui` that will be created and where the files will be dumped.
    const bundleFolder = bundle;
    const filesToCopy = [];
    if (bundle === 'notebook') {
        // Include files only for notebooks.
        filesToCopy.push(
            ...[
                {
                    from: 'out/ipywidgets/dist/ipywidgets.js',
                    context: './'
                },
                {
                    from: 'node_modules/font-awesome/**/*',
                    context: './'
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
                    to: path.join(constants.ExtensionRootDir, 'out', 'datascience-ui', bundleFolder)
                }
            ]
        );
    }
    let outputProps =
        bundle !== 'ipywidgetsRenderer'
            ? {}
            : {
                  library: 'LIB',
                  libraryTarget: 'var'
              };
    if (bundle === 'ipywidgetsRenderer' || bundle === 'ipywidgetsKernel') {
        filesToCopy.push({
            from: path.join(constants.ExtensionRootDir, 'src/datascience-ui/ipywidgets/kernel/require.js'),
            to: path.join(constants.ExtensionRootDir, 'out', 'datascience-ui', 'ipywidgetsKernel')
        });
    } else {
        filesToCopy.push({
            from: path.join(constants.ExtensionRootDir, 'node_modules/requirejs/require.js'),
            to: path.join(constants.ExtensionRootDir, 'out', 'datascience-ui', bundleFolder)
        });
    }
    const config = {
        context: constants.ExtensionRootDir,
        entry: getEntry(bundle),
        output: {
            path: path.join(constants.ExtensionRootDir, 'out', 'datascience-ui', bundleFolder),
            filename: '[name].js',
            chunkFilename: `[name].bundle.js`,
            pathinfo: false,
            ...outputProps
        },
        mode: isProdBuild ? 'production' : 'development', // Leave as is, we'll need to see stack traces when there are errors.
        devtool: isProdBuild ? undefined : 'inline-source-map',
        optimization: {
            minimize: isProdBuild,
            minimizer: isProdBuild ? [new TerserPlugin({ sourceMap: true })] : [],
            moduleIds: 'hashed', // (doesn't re-generate bundles unnecessarily) https://webpack.js.org/configuration/optimization/#optimizationmoduleids.
            splitChunks: {
                chunks: 'all',
                cacheGroups: {
                    // These are bundles that will be created and loaded when page first loads.
                    // These must be added to the page along with the main entry point.
                    // Smaller they are, the faster the load in SSH.
                    // Interactive and native editors will share common code in commons.
                    commons: {
                        name: 'commons',
                        chunks: 'initial',
                        minChunks: bundle === 'notebook' ? 2 : 1, // We want at least one shared bundle (2 for notebooks, as we want monago split into another).
                        filename: '[name].initial.bundle.js'
                    },
                    // Even though nteract has been split up, some of them are large as nteract alone is large.
                    // This will ensure nteract (just some of the nteract) goes into a separate bundle.
                    // Webpack will bundle others separately when loading them asynchronously using `await import(...)`
                    nteract: {
                        name: 'nteract',
                        chunks: 'all',
                        minChunks: 2,
                        test(module, _chunks) {
                            // `module.resource` contains the absolute path of the file on disk.
                            // Look for `node_modules/monaco...`.
                            const path = require('path');
                            return (
                                module.resource &&
                                module.resource.includes(`${path.sep}node_modules${path.sep}@nteract`)
                            );
                        }
                    },
                    // Bundling `plotly` with nteract isn't the best option, as this plotly alone is 6mb.
                    // This will ensure it is in a seprate bundle, hence small files for SSH scenarios.
                    plotly: {
                        name: 'plotly',
                        chunks: 'all',
                        minChunks: 1,
                        test(module, _chunks) {
                            // `module.resource` contains the absolute path of the file on disk.
                            // Look for `node_modules/monaco...`.
                            const path = require('path');
                            return (
                                module.resource && module.resource.includes(`${path.sep}node_modules${path.sep}plotly`)
                            );
                        }
                    },
                    // Monaco is a monster. For SSH again, we pull this into a seprate bundle.
                    // This is only a solution for SSH.
                    // Ideal solution would be to dynamically load monaoc `await import`, that way it will benefit UX and SSH.
                    // This solution doesn't improve UX, as we still need to wait for monaco to load.
                    monaco: {
                        name: 'monaco',
                        chunks: 'all',
                        minChunks: 1,
                        test(module, _chunks) {
                            // `module.resource` contains the absolute path of the file on disk.
                            // Look for `node_modules/monaco...`.
                            const path = require('path');
                            return (
                                module.resource && module.resource.includes(`${path.sep}node_modules${path.sep}monaco`)
                            );
                        }
                    }
                }
            },
            chunkIds: 'named'
        },
        node: {
            fs: 'empty'
        },
        plugins: [
            new FixDefaultImportPlugin(),
            new CopyWebpackPlugin({
                patterns: [...filesToCopy]
            }),
            new webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 100
            }),
            ...getPlugins(bundle)
        ],
        externals: ['log4js'],
        resolve: {
            // Add '.ts' and '.tsx' as resolvable extensions.
            extensions: ['.ts', '.tsx', '.js', '.json', '.svg']
        },

        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: [
                        { loader: 'cache-loader' },
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
                    use: ['cache-loader', 'thread-loader', 'svg-inline-loader']
                },
                {
                    test: /\.css$/,
                    use: ['cache-loader', 'thread-loader', 'style-loader', 'css-loader']
                },
                {
                    test: /\.js$/,
                    include: /node_modules.*remark.*default.*js/,
                    use: [
                        'cache-loader',
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
                        'cache-loader',
                        'thread-loader',
                        {
                            loader: path.resolve('./build/webpack/loaders/jsonloader.js'),
                            options: {}
                        }
                    ]
                },
                {
                    test: /\.(png|woff|woff2|eot|gif|ttf)$/,
                    use: [
                        'cache-loader',
                        'thread-loader',
                        {
                            loader: 'url-loader?limit=100000',
                            options: { esModule: false }
                        }
                    ]
                },
                {
                    test: /\.less$/,
                    use: ['cache-loader', 'thread-loader', 'style-loader', 'css-loader', 'less-loader']
                }
            ]
        }
    };

    // Do not split for renderer kernel.
    if (bundle === 'ipywidgetsKernel' || bundle === 'ipywidgetsRenderer') {
        delete config.optimization.splitChunks;
    }
    return config;
}

exports.notebooks = buildConfiguration('notebook');
exports.viewers = buildConfiguration('viewers');
exports.ipywidgetsKernel = buildConfiguration('ipywidgetsKernel');
exports.ipywidgetsRenderer = buildConfiguration('ipywidgetsRenderer');
