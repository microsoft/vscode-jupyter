// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as fs from 'fs-extra';
import * as path from '../../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';

suite('IPyWidgets Theming Bridge', () => {
    test('Bridge CSS exists and maps key JupyterLab vars', async () => {
        const cssPath = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src/webviews/webview-side/ipywidgets/renderer/jupyterlabThemeBridge.css'
        );
        expect(fs.pathExistsSync(cssPath)).to.equal(true, 'Bridge CSS file missing');
        const css = fs.readFileSync(cssPath, 'utf8');
        // Must scope to container to avoid global leaks
        expect(css).to.include('.cell-output-ipywidget-background');
        // Font family bridge
        expect(css).to.match(/--jp-ui-font-family:\s*var\(--vscode-editor-font-family\)/);
        // Foreground mapping
        expect(css).to.match(/--jp-content-font-color0:\s*var\(--vscode-editor-foreground\)/);
        // Border mapping
        expect(css).to.match(/--jp-border-color1:\s*var\(--vscode-panel-border.*\)/);
        // Widgets label color mapping
        expect(css).to.match(/--jp-widgets-label-color:\s*var\(--vscode-editor-foreground\)/);
        // Input color mappings
        expect(css).to.match(/--jp-widgets-input-color:\s*var\(--vscode-input-foreground.*\)/);
        expect(css).to.match(/--jp-widgets-input-background-color:\s*var\(/);
        expect(css).to.match(/--jp-widgets-input-border-color:\s*var\(/);
    });

    test('Renderer imports the bridge CSS', async () => {
        const rendererIndex = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src/webviews/webview-side/ipywidgets/renderer/index.ts'
        );
        const ts = fs.readFileSync(rendererIndex, 'utf8');
        expect(ts).to.match(/import '\.\/jupyterlabThemeBridge\.css';/);
    });

    test('Kernel imports the bridge CSS to cover kernel-created containers', async () => {
        const kernelIndex = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src/webviews/webview-side/ipywidgets/kernel/index.ts'
        );
        const ts = fs.readFileSync(kernelIndex, 'utf8');
        expect(ts).to.match(/import '\.\.\/renderer\/jupyterlabThemeBridge\.css';/);
    });

    test('No hardcoded white background for widget container', async () => {
        const files = [
            path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/webviews/webview-side/ipywidgets/renderer/styles.css'),
            path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/webviews/webview-side/interactive-common/common.css')
        ];
        for (const f of files) {
            const css = fs.readFileSync(f, 'utf8');
            const widgetBlockIndex = css.indexOf('.cell-output-ipywidget-background');
            expect(widgetBlockIndex).to.be.greaterThan(-1, `${path.basename(f)} missing widget container style`);
            // Ensure we don't force white background; allow transparent or theme var
            expect(css).to.not.match(/\.cell-output-ipywidget-background[\s\S]*background:\s*white/i);
        }
    });
});
