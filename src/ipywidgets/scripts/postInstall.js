// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

const fs = require('fs-extra');
const path = require('path');
const dirName = __dirname;

function ignoreTypescript4File(relativePath, searchString) {
    var filePath = path.join(dirName, '..', relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error("Typescript4 fixup not found '" + filePath + "' (pvsc post install script)");
    }
    var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    if (fileContents && !fileContents.includes('// @ts-ignore')) {
        let searchIndex = fileContents.indexOf(searchString);
        if (searchIndex > 0) {
            // Go up to previous line
            while (fileContents[searchIndex] != '\n') {
                searchIndex--;
            }
            const newFileContents = `${fileContents.substr(0, searchIndex + 1)}\n// @ts-ignore\n${fileContents.substr(
                searchIndex + 1
            )}`;
            fs.writeFileSync(filePath, newFileContents, { encoding: 'utf-8' });
        }
    }
}

/**
 * Widgets dont build with ts 4. This fixes up the errors in the widgets.
 */
function updateWidgetTypescript4() {
    const tagNameFiles = [
        'node_modules/@jupyter-widgets/controls/lib/widget_audio.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_bool.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_button.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_image.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_upload.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_video.d.ts'
    ];
    tagNameFiles.forEach((f) => {
        ignoreTypescript4File(f, 'get tagName(): string;');
    });
    const isDisposeFile = `node_modules/@jupyter-widgets/jupyterlab-manager/lib/renderer.d.ts`;
    ignoreTypescript4File(isDisposeFile, 'get isDisposed(): boolean;');
    const clientRectFile = `node_modules/@jupyterlab/codeeditor/lib/editor.d.ts`;
    ignoreTypescript4File(clientRectFile, ', ClientRect');
}

(async () => {
    updateWidgetTypescript4();
})().catch((ex) => console.error('Encountered error while running postInstall step', ex));
