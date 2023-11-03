// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import * as esbuild from 'esbuild';
import { green } from 'colors';
import type { BuildOptions, Charset, Loader, Plugin, SameShape } from 'esbuild';
import { lessLoader } from 'esbuild-plugin-less';
import fs from 'fs-extra';
import { getZeroMQPreBuildsFoldersToKeep, getBundleConfiguration, bundleConfiguration } from '../webpack/common';

// These will not be in the main desktop bundle, but will be in the web bundle.
// In desktop, we will bundle/copye each of these separately into the node_modules folder.
const deskTopNodeModulesToExternalize = [
    'pdfkit/js/pdfkit.standalone',
    'crypto-js',
    'fontkit',
    'png-js',
    'zeromq', // Copy, do not bundle
    'zeromqold', // Copy, do not bundle
    // Its lazy loaded by Jupyter lab code, & since this isn't used directly in our code
    // there's no need to include into the main bundle.
    'node-fetch',
    // Its loaded by node-fetch, & since that is lazy loaded
    // there's no need to include into the main bundle.
    'iconv-lite',
    // Its loaded by ivonv-lite, & since that is lazy loaded
    // there's no need to include into the main bundle.
    'fontkit',
    'svg-to-pdfkit',
    // Lazy loaded modules.
    'vscode-languageclient/node',
    '@vscode/jupyter-lsp-middleware',
    '@vscode/extension-telemetry',
    '@vscode/lsp-notebook-concat',
    '@jupyterlab/services',
    '@jupyterlab/nbformat',
    '@jupyterlab/services/lib/kernel/serialize',
    '@jupyterlab/services/lib/kernel/nonSerializingKernel',
    'vscode-jsonrpc' // Used by a few modules, might as well pull this out, instead of duplicating it in separate bundles.
];
const commonExternals = [
    'log4js',
    'vscode',
    'commonjs',
    'node:crypto',
    'vscode-jsonrpc', // Used by a few modules, might as well pull this out, instead of duplicating it in separate bundles.
    // jsonc-parser doesn't get bundled well with esbuild without any changes.
    // Its possible the fix is very simple.
    // For now, its handled with webpack.
    'jsonc-parser',
    // Ignore telemetry specific packages that are not required.
    'applicationinsights-native-metrics',
    '@opentelemetry/tracing',
    '@azure/opentelemetry-instrumentation-azure-sdk',
    '@opentelemetry/instrumentation',
    '@azure/functions-core'
];
const webExternals = commonExternals.concat('os').concat(commonExternals);
const desktopExternals = commonExternals.concat(deskTopNodeModulesToExternalize);
const bundleConfig = getBundleConfiguration();
const isDevbuild = !process.argv.includes('--production');
const isWatchMode = process.argv.includes('--watch');
const extensionFolder = path.join(__dirname, '..', '..');

interface StylePluginOptions {
    /**
     * whether to minify the css code.
     * @default true
     */
    minify?: boolean;

    /**
     * css charset.
     * @default 'utf8'
     */
    charset?: Charset;
}
const loader: { [ext: string]: Loader } = {
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.eot': 'dataurl',
    '.ttf': 'dataurl',
    '.gif': 'dataurl',
    '.svg': 'dataurl',
    '.png': 'dataurl'
};

// https://github.com/evanw/esbuild/issues/20#issuecomment-802269745
// https://github.com/hyrious/esbuild-plugin-style
function style({ minify = true, charset = 'utf8' }: StylePluginOptions = {}): Plugin {
    return {
        name: 'style',
        setup({ onResolve, onLoad }) {
            const cwd = process.cwd();
            const opt: BuildOptions = { logLevel: 'silent', bundle: true, write: false, charset, minify };

            onResolve({ filter: /\.css$/, namespace: 'file' }, (args) => {
                const absPath = path.join(args.resolveDir, args.path);
                const relPath = path.relative(cwd, absPath);
                const resolved = fs.existsSync(absPath) ? relPath : args.path;
                return { path: resolved, namespace: 'style-stub' };
            });

            onResolve({ filter: /\.css$/, namespace: 'style-stub' }, (args) => {
                return { path: args.path, namespace: 'style-content' };
            });

            onResolve({ filter: /^__style_helper__$/, namespace: 'style-stub' }, (args) => ({
                path: args.path,
                namespace: 'style-helper',
                sideEffects: false
            }));

            onLoad({ filter: /.*/, namespace: 'style-helper' }, async () => ({
                contents: `
            export function injectStyle(text) {
              if (typeof document !== 'undefined') {
                var style = document.createElement('style')
                var node = document.createTextNode(text)
                style.appendChild(node)
                document.head.appendChild(style)
              }
            }
          `
            }));

            onLoad({ filter: /.*/, namespace: 'style-stub' }, async (args) => ({
                contents: `
            import { injectStyle } from "__style_helper__"
            import css from ${JSON.stringify(args.path)}
            injectStyle(css)
          `
            }));

            onLoad({ filter: /.*/, namespace: 'style-content' }, async (args) => {
                const options = { entryPoints: [args.path], ...opt };
                options.loader = options.loader || {};
                // Add the same loaders we add for other places
                Object.keys(loader).forEach((key) => {
                    if (options.loader && !options.loader[key]) {
                        options.loader[key] = loader[key];
                    }
                });
                const { errors, warnings, outputFiles } = await esbuild.build(options);
                return { errors, warnings, contents: outputFiles![0].text, loader: 'text' };
            });
        }
    };
}

function createConfig(
    source: string,
    outfile: string,
    target: 'desktop' | 'web'
): SameShape<BuildOptions, BuildOptions> {
    const inject: string[] = [];
    if (target === 'web') {
        inject.push(path.join(__dirname, isDevbuild ? 'process.development.js' : 'process.production.js'));
    }
    if (source.endsWith(path.join('data-explorer', 'index.tsx'))) {
        inject.push(path.join(__dirname, 'jquery.js'));
    }
    const external = target === 'web' ? webExternals : commonExternals;
    if (source.toLowerCase().endsWith('extension.node.ts')) {
        external.push(...desktopExternals);
    }
    const isPreRelease = isDevbuild || process.env.IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION === 'true';
    const releaseVersionScriptFile = isPreRelease ? 'release.pre-release.js' : 'release.stable.js';
    const alias = {
        moment: path.join(extensionFolder, 'build', 'webpack', 'moment.js'),
        'vscode-jupyter-release-version': path.join(__dirname, releaseVersionScriptFile)
    };
    return {
        entryPoints: [source],
        outfile,
        bundle: true,
        external,
        alias,
        format: target === 'desktop' ? 'cjs' : 'esm',
        metafile: isDevbuild && !isWatchMode,
        define:
            target === 'desktop'
                ? undefined
                : {
                      BROWSER: 'true', // From webacpk scripts we had.
                      global: 'this'
                  },
        target: target === 'desktop' ? 'node18' : 'es2018',
        platform: target === 'desktop' ? 'node' : 'browser',
        minify: !isDevbuild,
        logLevel: 'info',
        sourcemap: isDevbuild,
        inject,
        plugins: target === 'desktop' ? [] : [style(), lessLoader()],
        loader: target === 'desktop' ? {} : loader
    };
}
async function build(
    source: string,
    outfile: string,
    options: { watch: boolean; target: 'desktop' | 'web' } = { watch: isWatchMode, target: 'web' }
) {
    if (options.watch) {
        const context = await esbuild.context(createConfig(source, outfile, options.target));
        await context.watch();
    } else {
        const result = await esbuild.build(createConfig(source, outfile, options.target));
        const size = fs.statSync(outfile).size;
        const relativePath = `./${path.relative(extensionFolder, outfile)}`;
        console.log(`asset ${green(relativePath)} size: ${(size / 1024).toFixed()} KiB`);
        if (isDevbuild && result.metafile) {
            const metafile = `${outfile}.esbuild.meta.json`;
            await fs.writeFile(metafile, JSON.stringify(result.metafile));
            console.log(`metafile ${green(`./${path.relative(extensionFolder, metafile)}`)}`);
        }
    }
}

async function buildAll() {
    // First build the less file format, convert to css, and then build tsx to use the css
    // The source imports the css files.
    const getLessBuilders = (watch = isWatchMode) => {
        return [
            build(
                path.join(
                    extensionFolder,
                    'src',
                    'webviews',
                    'webview-side',
                    'interactive-common',
                    'variableExplorerGrid.less'
                ),
                path.join(
                    extensionFolder,
                    'src',
                    'webviews',
                    'webview-side',
                    'interactive-common',
                    'variableExplorerGrid.css'
                )
            ),
            build(
                path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'react-common', 'seti', 'seti.less'),
                path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'react-common', 'seti', 'seti.css')
            )
        ];
    };
    await Promise.all(getLessBuilders(false));

    await Promise.all([
        // Run less builders again, in case we are in watch mode.
        ...[isWatchMode ? getLessBuilders(true) : []],
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'ipywidgets', 'kernel', 'index.ts'),
            path.join(extensionFolder, 'dist', 'webviews', 'webview-side', 'ipywidgetsKernel', 'ipywidgetsKernel.js'),
            { target: 'web', watch: isWatchMode }
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'ipywidgets', 'renderer', 'index.ts'),
            path.join(
                extensionFolder,
                'dist',
                'webviews',
                'webview-side',
                'ipywidgetsRenderer',
                'ipywidgetsRenderer.js'
            ),
            { target: 'web', watch: isWatchMode }
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'variable-view', 'index.tsx'),
            path.join(extensionFolder, 'dist', 'webviews', 'webview-side', 'viewers', 'variableView.js'),
            { target: 'web', watch: isWatchMode }
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'plot', 'index.tsx'),
            path.join(extensionFolder, 'dist', 'webviews', 'webview-side', 'viewers', 'plotViewer.js'),
            { target: 'web', watch: isWatchMode }
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'data-explorer', 'index.tsx'),
            path.join(extensionFolder, 'dist', 'webviews', 'webview-side', 'viewers', 'dataExplorer.js'),
            { target: 'web', watch: isWatchMode }
        ),
        ,
        isDevbuild
            ? build(
                  path.join(extensionFolder, 'src', 'test', 'datascience', 'widgets', 'rendererUtils.ts'),
                  path.join(extensionFolder, 'dist', 'webviews', 'webview-side', 'widgetTester', 'widgetTester.js'),
                  { target: 'web', watch: isWatchMode }
              )
            : Promise.resolve(),
        ,
        // bundleConfig === 'desktop'
        //     ? Promise.resolve()
        //     : build(
        //           path.join(extensionFolder, 'src', 'extension.web.ts'),
        //           path.join(extensionFolder, 'dist', 'extension.web.bundle.js'),
        //           { target: 'web', watch: isWatchMode }
        //       ),
        bundleConfig === 'web'
            ? Promise.resolve()
            : build(
                  path.join(extensionFolder, 'src', 'extension.node.ts'),
                  path.join(extensionFolder, 'dist', 'extension.node.js'),
                  { target: 'desktop', watch: isWatchMode }
              ),
        bundleConfig === 'web'
            ? Promise.resolve()
            : build(
                  path.join(extensionFolder, 'src', 'extension.node.proxy.ts'),
                  path.join(extensionFolder, 'dist', 'extension.node.proxy.js'),
                  { target: 'desktop', watch: isWatchMode }
              ),
        ...(bundleConfig === 'web' ? [] : deskTopNodeModulesToExternalize)
            // zeromq will be manually bundled.
            .filter((module) => !['zeromq', 'zeromqold', 'vscode-jsonrpc'].includes(module))

            .map(async (module) => {
                const fullPath = require.resolve(module);
                return build(fullPath, path.join(extensionFolder, 'dist', 'node_modules', `${module}.js`), {
                    target: 'desktop',
                    watch: isWatchMode
                });
            }),
        ...(bundleConfig === 'web'
            ? []
            : [copyJQuery(), copyAminya(), copyZeroMQ(), copyZeroMQOld(), buildVSCodeJsonRPC()])
    ]);
}

/**
 * TODO: Who uses JQuery?
 * Possibly shipped for widgets.
 * Need to verify this, if this is the case, then possibly best shipped with renderers.
 */
async function copyJQuery() {
    const source = require.resolve('jquery').replace('jquery.js', 'jquery.min.js');
    const target = path.join(extensionFolder, 'dist', 'node_modules', 'jquery', 'out', 'jquery.min.js');
    const license = require.resolve('jquery').replace(path.join('out', 'jquery.js'), 'LICENSE.txt');
    await fs.ensureDir(path.dirname(target));
    await Promise.all([
        fs.copyFile(source, target),
        fs.copyFile(license, path.join(extensionFolder, 'dist', 'node_modules', 'jquery', 'LICENSE.txt'))
    ]);
}

async function copyAminya() {
    const source = path.join(extensionFolder, 'node_modules', '@aminya/node-gyp-build');
    const target = path.join(extensionFolder, 'dist', 'node_modules', '@aminya/node-gyp-build');
    await fs.ensureDir(path.dirname(target));
    await fs.ensureDir(target);
    await fs.copy(source, target, { recursive: true });
}
async function copyZeroMQ() {
    const source = path.join(extensionFolder, 'node_modules', 'zeromq');
    const target = path.join(extensionFolder, 'dist', 'node_modules', 'zeromq');
    await fs.ensureDir(target);
    await fs.copy(source, target, {
        recursive: true,
        filter: (src) => shouldCopyFileFromZmqFolder(src)
    });
}
async function copyZeroMQOld() {
    const source = path.join(extensionFolder, 'node_modules', 'zeromqold');
    const target = path.join(extensionFolder, 'dist', 'node_modules', 'zeromqold');
    await fs.ensureDir(path.dirname(target));
    await fs.ensureDir(target);
    await fs.copy(source, target, {
        recursive: true,
        filter: (src) => shouldCopyFileFromZmqFolder(src)
    });
}
async function buildVSCodeJsonRPC() {
    const source = path.join(extensionFolder, 'node_modules', 'vscode-jsonrpc');
    const target = path.join(extensionFolder, 'dist', 'node_modules', 'vscode-jsonrpc', 'index.js');
    await fs.ensureDir(path.dirname(target));
    const fullPath = require.resolve(source);
    const contents = `
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ----------------------------------------------------------------------------------------- */
'use strict';

module.exports = require('./index');`;
    await fs.writeFile(path.join(path.dirname(target), 'node.js'), contents);
    return build(fullPath, target, {
        target: 'desktop',
        watch: isWatchMode
    });
}

function shouldCopyFileFromZmqFolder(resourcePath) {
    const parentFolder = path.dirname(resourcePath);
    if (fs.statSync(resourcePath).isDirectory()) {
        return true;
    }
    // return true;
    const filename = path.basename(resourcePath);
    // Ensure the code is platform agnostic.
    resourcePath = (resourcePath || '').toString().toLowerCase().replace(/\\/g, '/');
    // We do not need to bundle these folders
    const foldersToIgnore = ['build', 'script', 'src', 'node_modules', 'vendor'];
    if (
        foldersToIgnore.some((folder) =>
            resourcePath.toLowerCase().startsWith(path.join(parentFolder, folder).replace(/\\/g, '/').toLowerCase())
        )
    ) {
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
    // if (!resourcePath.includes(path.join(parentFolder, 'prebuilds').replace(/\\/g, '/').toLowerCase())) {
    if (!parentFolder.includes(`${path.sep}prebuilds${path.sep}`)) {
        // We do not ship any other sub directory.
        return false;
    }
    if (filename.includes('electron.') && resourcePath.endsWith('.node')) {
        // We do not ship electron binaries.
        return false;
    }
    const preBuildsFoldersToCopy = getZeroMQPreBuildsFoldersToKeep();
    if (preBuildsFoldersToCopy.length === 0) {
        // Copy everything from all prebuilds folder.
        return true;
    }
    // Copy if this is a prebuilds folder that needs to be copied across.
    // Use path.sep as the delimiter, as we do not want linux-arm64 to get compiled with search criteria is linux-arm.
    if (preBuildsFoldersToCopy.some((folder) => resourcePath.includes(`${folder.toLowerCase()}/`))) {
        return true;
    }
    return false;
}

const started = Date.now();
buildAll();
