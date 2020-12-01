// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

var colors = require('colors/safe');
var fs = require('fs-extra');
var path = require('path');
var constants_1 = require('../constants');
var cp = require('child_process');
var download = require('download');
/**
 * In order to compile the extension in strict mode, one of the dependencies (@jupyterlab) has some files that
 * just won't compile in strict mode.
 * Unfortunately we cannot fix it by overriding their type definitions
 * Note: that has been done for a few of the JupyterLabl files (see typings/index.d.ts).
 * The solution is to modify the type definition file after `npm install`.
 */
function fixJupyterLabDTSFiles() {
    var relativePath = path.join(
        'node_modules',
        '@jupyterlab',
        'services',
        'node_modules',
        '@jupyterlab',
        'coreutils',
        'lib',
        'settingregistry.d.ts'
    );
    var filePath = path.join(constants_1.ExtensionRootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error("Type Definition file from JupyterLab not found '" + filePath + "' (pvsc post install script)");
    }
    var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    if (fileContents.indexOf('[key: string]: ISchema | undefined;') > 0) {
        // tslint:disable-next-line:no-console
        console.log(colors.blue(relativePath + ' file already updated (by Jupyter VSC)'));
        return;
    }
    if (fileContents.indexOf('[key: string]: ISchema;') > 0) {
        var replacedText = fileContents.replace('[key: string]: ISchema;', '[key: string]: ISchema | undefined;');
        if (fileContents === replacedText) {
            throw new Error("Fix for JupyterLabl file 'settingregistry.d.ts' failed (pvsc post install script)");
        }
        fs.writeFileSync(filePath, replacedText);
        // tslint:disable-next-line:no-console
        console.log(colors.green(relativePath + ' file updated (by Jupyter VSC)'));
    } else {
        // tslint:disable-next-line:no-console
        console.log(colors.red(relativePath + ' file does not need updating.'));
    }
}

/**
 * In order to get raw kernels working, we reuse the default kernel that jupyterlab ships.
 * However it expects to be talking to a websocket which is serializing the messages to strings.
 * Our raw kernel is not a web socket and needs to do its own serialization. To do so, we make a copy
 * of the default kernel with the serialization stripped out. This is simpler than making a copy of the module
 * at runtime.
 */
function createJupyterKernelWithoutSerialization() {
    var relativePath = path.join('node_modules', '@jupyterlab', 'services', 'lib', 'kernel', 'default.js');
    var filePath = path.join(constants_1.ExtensionRootDir, relativePath);
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
 * In order to generate random bytes on Windows without taking a dependency on native node modules
 * which we then need to build xplat and bundle with the extension, download a prebuilt executable
 * which directly consumes BCryptGenRandom in bcrypt.dll and outputs random bytes as hex. This
 * executable is required for trusted notebooks key generation and is included with the built extension.
 */
async function downloadBCryptGenRandomExecutable() {
    console.log('Downloading BCryptGenRandom.exe...');
    const executableName = 'BCryptGenRandom.exe';
    const uri = `https://pvsc.blob.core.windows.net/extension-builds-juypter/${executableName}`;
    const srcDestination = path.resolve(path.dirname(__dirname), '..', 'src', 'BCryptGenRandom');
    const destinationFilename = path.join(srcDestination, executableName);
    if (fs.existsSync(destinationFilename)) {
        console.log('BCryptGenRandom.exe is already downloaded.');
    } else {
        fs.ensureDirSync(srcDestination);
        await download(uri, srcDestination, { filename: executableName });
        console.log('Downloaded BCryptGenRandom.exe.');
    }
    const outDestination = path.resolve(path.dirname(__dirname), '..', 'out', 'BCryptGenRandom');
    if (fs.existsSync(outDestination)) {
        console.log('BCryptGenRandom.exe is already copied to outdir.');
    } else {
        fs.copyFileSync(srcDestination, outDestination);
        console.log('Copied BCryptGenRandom.exe to outdir');
    }
}

(async () => {
    fixJupyterLabDTSFiles();
    createJupyterKernelWithoutSerialization();
    await downloadBCryptGenRandomExecutable();
})().catch((ex) => console.error('Encountered error while running postInstall step', ex));
