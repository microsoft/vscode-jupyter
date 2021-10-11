// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

const colors = require('colors/safe');
const fs = require('fs-extra');
const path = require('path');
const constants = require('../constants');

/**
 * In order to get raw kernels working, we reuse the default kernel that jupyterlab ships.
 * However it expects to be talking to a websocket which is serializing the messages to strings.
 * Our raw kernel is not a web socket and needs to do its own serialization. To do so, we make a copy
 * of the default kernel with the serialization stripped out. This is simpler than making a copy of the module
 * at runtime.
 */
function createJupyterKernelWithoutSerialization() {
    var relativePath = path.join('node_modules', '@jupyterlab', 'services', 'lib', 'kernel', 'default.js');
    var filePath = path.join(constants.ExtensionRootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error(
            "Jupyter lab default kernel not found '" + filePath + "' (Jupyter Extension post install script)"
        );
    }
    var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    var replacedContents = fileContents.replace(
        /^const serialize =.*$/gm,
        'const serialize = { serialize: (a) => a, deserialize: (a) => a };'
    );
    if (replacedContents === fileContents) {
        throw new Error('Jupyter lab default kernel cannot be made non serializing');
    }
    var destPath = path.join(path.dirname(filePath), 'nonSerializingKernel.js');
    fs.writeFileSync(destPath, replacedContents);
    console.log(colors.green(destPath + ' file generated (by Jupyter VSC)'));
}

/**
 * The Variable Explorer currently uses react-data-grid@6.1.0 and is the only component that does.
 * We retrieve variable names sorted so there will never be a time where variables are unsorted.
 * react-data-grid is on v7+ now and a PR to implement this would cause a lot of cascading changes for us,
 * so we modify the compiled javascript so that the react-data-grid is always sorted by something.
 */
function makeVariableExplorerAlwaysSorted() {
    const fileNames = ['react-data-grid.js', 'react-data-grid.min.js'];
    const alwaysSortedCode = 'case g.NONE:e=r?g.DESC:g.ASC;break;case g.ASC:e=g.DESC;break;case g.DESC:e=g.ASC';
    const originalCode =
        'case g.NONE:e=r?g.DESC:g.ASC;break;case g.ASC:e=r?g.NONE:g.DESC;break;case g.DESC:e=r?g.ASC:g.NONE';
    for (const fileName of fileNames) {
        var relativePath = path.join('node_modules', 'react-data-grid', 'dist', fileName);
        var filePath = path.join(constants.ExtensionRootDir, relativePath);
        if (!fs.existsSync(filePath)) {
            throw new Error("react-data-grid dist file not found '" + filePath + "' (pvsc post install script)");
        }
        var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
        if (fileContents.indexOf(alwaysSortedCode) > 0) {
            // tslint:disable-next-line:no-console
            console.log(colors.blue(relativePath + ' file already updated (by Jupyter VSC)'));
            return;
        }
        if (fileContents.indexOf(originalCode) > 0) {
            var replacedText = fileContents.replace(originalCode, alwaysSortedCode);
            if (fileContents === replacedText) {
                throw new Error(`Fix for react-data-grid file ${fileName} failed (pvsc post install script)`);
            }
            fs.writeFileSync(filePath, replacedText);
            // tslint:disable-next-line:no-console
            console.log(colors.green(relativePath + ' file updated (by Jupyter VSC)'));
        } else {
            // tslint:disable-next-line:no-console
            console.log(colors.red(relativePath + ' file does not need updating.'));
        }
    }
}

function ignoreTypescript4File(relativePath, searchString) {
    var filePath = path.join(constants.ExtensionRootDir, relativePath);
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
            const newFileContents = `${fileContents.substr(0, searchIndex+1)}\n// @ts-ignore\n${fileContents.substr(searchIndex+1)}`;
            fs.writeFileSync(filePath, newFileContents, {encoding: 'utf-8'});
        }
    }
}

function updateWidgetTypescript4() {
    const tagNameFiles = [
        'node_modules/@jupyter-widgets/controls/lib/widget_audio.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_bool.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_button.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_image.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_upload.d.ts',
        'node_modules/@jupyter-widgets/controls/lib/widget_video.d.ts'
    ]
    tagNameFiles.forEach(f => {
        ignoreTypescript4File(f, 'get tagName(): string;');
    });
    const isDisposeFile = `node_modules/@jupyter-widgets/jupyterlab-manager/lib/renderer.d.ts`
    ignoreTypescript4File(isDisposeFile, 'get isDisposed(): boolean;');
}

(async () => {
    makeVariableExplorerAlwaysSorted();
    createJupyterKernelWithoutSerialization();
    updateWidgetTypescript4();
})().catch((ex) => console.error('Encountered error while running postInstall step', ex));
