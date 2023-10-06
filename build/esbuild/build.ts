// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import * as esbuild from 'esbuild';
import { green } from 'colors';
import type { BuildOptions, Charset, Plugin, SameShape } from 'esbuild';
import { lessLoader } from 'esbuild-plugin-less';
import fs from 'fs';

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
                const { errors, warnings, outputFiles } = await esbuild.build(options);
                return { errors, warnings, contents: outputFiles![0].text, loader: 'text' };
            });
        }
    };
}

function createConfig(source: string, outfile: string): SameShape<BuildOptions, BuildOptions> {
    return {
        entryPoints: [source],
        outfile,
        bundle: true,
        external: ['log4js'], // From webacpk scripts we had.
        format: 'esm',
        define: {
            BROWSER: 'true', // From webacpk scripts we had.
            global: 'this'
        },
        target: 'es2018',
        minify: !isDevbuild,
        logLevel: 'info',
        sourcemap: isDevbuild,
        inject: [path.join(__dirname, isDevbuild ? 'process.development.js' : 'process.production.js')],
        plugins: [style(), lessLoader()],
        loader: {
            '.woff': 'dataurl',
            '.woff2': 'dataurl',
            '.eot': 'dataurl',
            '.ttf': 'dataurl',
            '.gif': 'dataurl',
            '.svg': 'dataurl',
            '.png': 'dataurl'
        }
    };
}
async function build(source: string, outfile: string, watch = isWatchMode) {
    if (watch) {
        const context = await esbuild.context(createConfig(source, outfile));
        await context.watch();
    } else {
        await esbuild.build(createConfig(source, outfile));
        const size = fs.statSync(outfile).size;
        const relativePath = `./${path.relative(extensionFolder, outfile)}`;
        console.log(`asset ${green(relativePath)} size: ${(size / 1024).toFixed()} KiB`);
    }
}
async function watch(source: string, outfile: string) {}

async function buildAll() {
    // First build the less file format, convert to css, and then build tsx to use the css
    // The source imports the css files.
    await build(
        path.join(
            extensionFolder,
            'src',
            'webviews',
            'webview-side',
            'interactive-common',
            'variableExplorerGrid.less'
        ),
        path.join(extensionFolder, 'src', 'webviews', 'webview-side', 'interactive-common', 'variableExplorerGrid.css'),
        false
    );

    await Promise.all([
        // Run again, in case we are in watch mode.
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
        ,
        isDevbuild
            ? build(
                  path.join(extensionFolder, 'src', 'test', 'datascience', 'widgets', 'rendererUtils.ts'),
                  path.join(extensionFolder, 'out', 'webviews', 'webview-side', 'widgetTester', 'widgetTester.js')
              )
            : Promise.resolve()
    ]);
}

const started = Date.now();
buildAll();
