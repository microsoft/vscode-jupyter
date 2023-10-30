// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import * as esbuild from 'esbuild';
import { green } from 'colors';
import type { BuildOptions, Charset, Loader, Plugin, SameShape } from 'esbuild';
import { lessLoader } from 'esbuild-plugin-less';
import fs from 'fs-extra';
import { nodeModulesToExternalize } from '../webpack/common';
import { getZeroMQPreBuildsFoldersToKeep } from '../webpack/common';

const isDevbuild = !process.argv.includes('--production');
const esbuildAll = process.argv.includes('--all');
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
    const desktopExternals = [
        'zeromq',
        'zeromqold',
        '@vscode/jupyter-ipywidgets7',
        'pdfkit/js/pdfkit.standalone',
        'crypto-js',
        'fontkit',
        'png-js',
        'zeromq',
        // Make this external,
        // Its lazy loaded by Jupyter lab code.
        // Thus if jupyterlab code is lazy loaded, this will be lazy loaded,
        // Meaning a lot of the dependencies will be lazy loaded, leading to faster ext loading.
        'node-fetch',
        // Lazy load for faster ext loading.
        'svg-to-pdfkit',
        // jsonc-parser doesn't get bundled well with esbuild without any changes.
        // Its possible the fix is very simple.
        'jsonc-parser',
        // Ignore telemetry specific packages that are not required.
        '@opentelemetry/tracing',
        'applicationinsights-native-metrics',
        '@azure/functions-core',
        '@azure/opentelemetry-instrumentation-azure-sdk',
        '@opentelemetry/instrumentation'
    ];
    if (source.endsWith('extension.node.ts')) {
        // In other bundles these can get pulled in,
        // but in the main bundle we do not want to pull these in.
        // language client is lazy loaded in main bundle
        // & required in lsp-middleware, etc
        desktopExternals.push(
            ...[
                'vscode-languageclient',
                'vscode-languageclient/node',
                '@vscode/jupyter-lsp-middleware',
                '@vscode/extension-telemetry',
                '@vscode/lsp-notebook-concat',
                '@jupyterlab/services',
                '@jupyterlab/nbformat',
                '@jupyterlab/services/lib/kernel/serialize',
                '@jupyterlab/services/lib/kernel/nonSerializingKernel'
            ]
        );
    }
    const webExternals = ['os'];
    const external = ['log4js', 'vscode', 'commonjs', 'node:crypto'].concat(
        target === 'web' ? webExternals : desktopExternals
    );
    const alias = {
        moment: path.join(extensionFolder, 'build', 'webpack', 'moment.js')
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
            path.join(extensionFolder, 'out', 'webviews', 'webview-side', 'ipywidgetsKernel', 'ipywidgetsKernel.js')
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'ipywidgets', 'renderer', 'index.ts'),
            path.join(extensionFolder, 'out', 'webviews', 'webview-side', 'ipywidgetsRenderer', 'ipywidgetsRenderer.js')
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'variable-view', 'index.tsx'),
            path.join(extensionFolder, 'out', 'webviews', 'webview-side', 'viewers', 'variableView.js')
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'plot', 'index.tsx'),
            path.join(extensionFolder, 'out', 'webviews', 'webview-side', 'viewers', 'plotViewer.js')
        ),
        build(
            path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'data-explorer', 'index.tsx'),
            path.join(extensionFolder, 'out', 'webviews', 'webview-side', 'viewers', 'dataExplorer.js')
        ),
        ,
        isDevbuild
            ? build(
                  path.join(extensionFolder, 'src', 'test', 'datascience', 'widgets', 'rendererUtils.ts'),
                  path.join(extensionFolder, 'out', 'webviews', 'webview-side', 'widgetTester', 'widgetTester.js')
              )
            : Promise.resolve(),
        ,
        build(
            path.join(extensionFolder, 'src', 'extension.web.ts'),
            path.join(extensionFolder, 'out', 'extension.web.bundle.js')
        ),
        ...(esbuildAll
            ? [buildDesktopBundle()]
            : nodeModulesToExternalize.map(async (module) => {
                  let fullPath = path.join(extensionFolder, 'node_modules', `${module}.js`);
                  if (!fs.existsSync(fullPath)) {
                      fullPath = require.resolve(path.join(extensionFolder, 'node_modules', module));
                      console.error(fullPath);
                  }
                  return build(fullPath, fullPath.replace('node_modules', path.join('out', 'node_modules')), {
                      target: 'desktop',
                      watch: isWatchMode
                  });
              }))
    ]);
}

async function buildDesktopBundle() {
    await Promise.all([
        build(
            path.join(extensionFolder, 'src', 'extension.node.ts'),
            path.join(extensionFolder, 'out', 'extension.node.js'),
            { target: 'desktop', watch: isWatchMode }
        ),
        ...Array.from(
            new Set(
                nodeModulesToExternalize
                    .concat(
                        'node-fetch',
                        'vscode-languageclient/node',
                        '@vscode/jupyter-lsp-middleware',
                        'svg-to-pdfkit',
                        '@vscode/extension-telemetry',
                        '@jupyterlab/services',
                        '@jupyterlab/nbformat',
                        '@vscode/lsp-notebook-concat',
                        '@jupyterlab/services/lib/kernel/serialize',
                        '@jupyterlab/services/lib/kernel/nonSerializingKernel'
                    )
                    .filter((module) => !['zeromq', 'zeromqold'].includes(module))
            )
        ).map(async (module) => {
            const fullPath = require.resolve(module);
            return build(fullPath, path.join(extensionFolder, 'out', 'node_modules', `${module}.js`), {
                target: 'desktop',
                watch: isWatchMode
            });
        }),
        copyJQuery(),
        copyAminya(),
        copyZeroMQ(),
        copyZeroMQOld()
    ]);
}
/**
 * TODO: Who uses JQuery?
 * Possibly shipped for widgets.
 * Need to verify this, if this is the case, then possibly best shipped with renderers.
 */
async function copyJQuery() {
    const source = require.resolve('jquery').replace('jquery.js', 'jquery.min.js');
    const target = path.join(extensionFolder, 'out', 'node_modules', 'jquery', 'out', 'jquery.min.js');
    const license = require.resolve('jquery').replace(path.join('out', 'jquery.js'), 'LICENSE.txt');
    await fs.ensureDir(path.dirname(target));
    await Promise.all([
        fs.copyFile(source, target),
        fs.copyFile(license, path.join(extensionFolder, 'out', 'node_modules', 'jquery', 'LICENSE.txt'))
    ]);
}

async function copyAminya() {
    const source = path.join(extensionFolder, 'node_modules', '@aminya/node-gyp-build');
    const target = path.join(extensionFolder, 'out', 'node_modules', '@aminya/node-gyp-build');
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target, { recursive: true });
}
async function copyZeroMQ() {
    const source = path.join(extensionFolder, 'node_modules', 'zeromq');
    const target = path.join(extensionFolder, 'out', 'node_modules', 'zeromq');
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target, {
        recursive: true,
        filter: (src) => shouldCopyFileFromZmqFolder(src)
    });
}
async function copyZeroMQOld() {
    const source = path.join(extensionFolder, 'node_modules', 'zeromqold');
    const target = path.join(extensionFolder, 'out', 'node_modules', 'zeromqold');
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target, {
        recursive: true,
        filter: (src) => shouldCopyFileFromZmqFolder(src)
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
