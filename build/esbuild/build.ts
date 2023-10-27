// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import * as esbuild from 'esbuild';
import { green } from 'colors';
import type { BuildOptions, Charset, Loader, Plugin, SameShape } from 'esbuild';
import { lessLoader } from 'esbuild-plugin-less';
import fs from 'fs';
import { nodeModulesToExternalize } from '../webpack/common';

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
    const inject = [path.join(__dirname, isDevbuild ? 'process.development.js' : 'process.production.js')];
    if (source.endsWith(path.join('data-explorer', 'index.tsx'))) {
        inject.push(path.join(__dirname, 'jquery.js'));
    }
    return {
        entryPoints: [source],
        outfile,
        bundle: true,
        external: ['log4js', 'vscode', 'commonjs'], // From webacpk scripts we had.
        format: 'esm',
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
        await esbuild.build(createConfig(source, outfile, options.target));
        const size = fs.statSync(outfile).size;
        const relativePath = `./${path.relative(extensionFolder, outfile)}`;
        console.log(`asset ${green(relativePath)} size: ${(size / 1024).toFixed()} KiB`);
    }
}
async function watch(source: string, outfile: string) {}

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
                ),
                watch
            ),
            build(
                path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'react-common', 'seti', 'seti.less'),
                path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'react-common', 'seti', 'seti.css'),
                watch
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
        ...nodeModulesToExternalize.map(async (module) => {
            let fullPath = path.join(extensionFolder, 'node_modules', `${module}.js`);
            if (!fs.existsSync(fullPath)) {
                fullPath = require.resolve(path.join(extensionFolder, 'node_modules', module));
                console.error(fullPath);
            }
            return build(fullPath, fullPath.replace('node_modules', path.join('out', 'node_modules')), {
                target: 'desktop',
                watch: isWatchMode
            });
        })
    ]);
}

const started = Date.now();
buildAll();
