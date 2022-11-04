// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { lessLoader } = require('esbuild-plugin-less');
const path = require('path');
const fs = require('fs-extra');
const { nodeModulesToExternalize } = require('./common');
const constants = require('../constants');
const cssModulesPlugin = require('esbuild-css-modules-plugin');
const resolve = require('esbuild-plugin-resolve');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');

function fixFaultyFile() {
    const faultyFile = 'node_modules/react-virtualized/dist/es/WindowScroller/utils/onScroll.js';
    const faultyContent = `import { bpfrpt_proptype_WindowScroller } from "../WindowScroller.js";`;
    const file = path.resolve(path.join(__dirname, '..', '..', faultyFile));
    const contents = fs.readFileSync(faultyFile).toString();
    if (contents.includes(faultyContent)) {
        fs.writeFileSync(faultyFile, contents.replace(faultyContent, ''));
    }
}
async function bundle() {
    fixFaultyFile();
    await Promise.all([
        ...nodeModulesToExternalize.map(bundleNodeModule),
        ...webFiles.map(bundleWebModule),
        ...[bundleWebExtension()]
    ]);
    console.info('Successfully built.');
}

async function bundleNodeModule(nodeModule) {
    const entry = path.resolve(path.join(__dirname, '..', '..', 'node_modules', nodeModule));
    const outfile = path.resolve(path.join(__dirname, '..', '..', 'out', 'node_modules', `${nodeModule}.js`));
    await fs.ensureDir(path.dirname(outfile));

    await require('esbuild').build({
        entryPoints: [entry],
        bundle: true,
        sourcemap: true,
        outfile,
        platform: 'node'
    });
}

const webFiles = [
    {
        source: './src/webviews/webview-side/ipywidgets/kernel/index.ts',
        target: 'out/webviews/webview-side/ipywidgetsKernel/ipywidgetsKernel.js'
    },
    {
        source: './src/webviews/webview-side/ipywidgets/renderer/index.ts',
        target: 'out/webviews/webview-side/ipywidgetsRenderer/ipywidgetsRenderer.js'
    },
    {
        source: './src/webviews/webview-side/error-renderer/index.ts',
        target: 'out/webviews/webview-side/errorRenderer/errorRenderer.js'
    },
    {
        source: './src/test/datascience/widgets/rendererUtils.ts',
        target: 'out/webviews/webview-side/widgetTester/widgetTester.js'
    },
    {
        source: './src/webviews/webview-side/plot/index.tsx',
        target: 'out/webviews/webview-side/viewers/plotViewer.js'
    },
    {
        source: './src/webviews/webview-side/data-explorer/index.tsx',
        target: 'out/webviews/webview-side/viewers/dataExplorer.js'
    },
    {
        source: './src/webviews/webview-side/variable-view/index.tsx',
        target: 'out/webviews/webview-side/viewers/variableView.js'
    },
    {
        source: './src/webviews/webview-side/variable-view/index.tsx',
        target: 'out/webviews/webview-side/viewers/variableView.js'
    }
];

async function bundleWebModule({ source, target }) {
    const entry = path.resolve(path.join(__dirname, '..', '..', source));
    const outfile = path.resolve(path.join(__dirname, '..', '..', target));
    await fs.ensureDir(path.dirname(outfile));
    await require('esbuild').build({
        entryPoints: [entry],
        bundle: true,
        sourcemap: true,
        outfile,
        format: 'esm',
        plugins: [
            lessLoader()
            // cssModulesPlugin({
            //     inject: true,
            //     v2: true
            // })
        ],
        loader: {
            '.png': 'dataurl',
            '.gif': 'dataurl',
            '.svg': 'text',
            '.woff': 'dataurl',
            '.woff2': 'dataurl',
            '.eot': 'dataurl',
            '.ttf': 'dataurl',
            '.svg': 'dataurl'
        }
    });
}

const devEntry = './src/extension.web.ts';
const testEntry = './src/test/web/index.ts'; // source of the web extension test runner
async function bundleWebExtension() {
    const mainEntry = process.env.VSC_TEST_BUNDLE === 'true' ? testEntry : devEntry;
    const entry = path.resolve(path.join(__dirname, '..', '..', mainEntry));
    const outfile = path.resolve(path.join(__dirname, '..', '..', 'out', 'index.web.bundle.js'));
    await fs.ensureDir(path.dirname(outfile));
    const tsconfig = path.join(constants.ExtensionRootDir, 'tsconfig.extension.web.json');
    const envVariables = {
        // Definitions...
        BROWSER: JSON.stringify(true),
        process: JSON.stringify({
            platform: 'web'
        }),
        IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION: JSON.stringify(
            typeof process.env.IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION === 'string'
                ? process.env.IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION
                : 'true'
        ),
        VSC_JUPYTER_CI_TEST_GREP: JSON.stringify(
            typeof process.env.VSC_JUPYTER_CI_TEST_GREP === 'string' ? process.env.VSC_JUPYTER_CI_TEST_GREP : ''
        )
    };
    console.error(envVariables);
    await require('esbuild').build({
        entryPoints: [entry],
        bundle: true,
        tsconfig,
        sourcemap: true,
        outfile,
        define: envVariables,
        external: ['vscode', 'commonjs', 'electron'],
        format: 'esm',
        plugins: [
            lessLoader(),
            resolve({
                crypto: require.resolve(path.join(constants.ExtensionRootDir, 'src/platform/msrCrypto/msrCrypto.js')),
                fs: path.join(__dirname, 'fs-empty.js'),
                inherits: require.resolve('inherits')
            }),
            polyfillNode({
                // Options (optional)
                globals: {
                    buffer: true
                    // process: true,
                },
                polyfills: {
                    assert: true,
                    buffer: true,
                    fs: false,
                    path: true,
                    os: true,
                    stream: true
                }
            })

            // cssModulesPlugin({
            //     inject: true,
            //     v2: true
            // })
        ],
        loader: {
            '.png': 'dataurl',
            '.gif': 'dataurl',
            '.svg': 'text',
            '.woff': 'dataurl',
            '.woff2': 'dataurl',
            '.eot': 'dataurl',
            '.ttf': 'dataurl',
            '.svg': 'dataurl'
        }
    });
}

exports.bundle = bundle;
// bundle().catch((ex) => console.error(ex));
// bundleWebExtension().catch((ex) => console.error(ex));
