// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

const fs = require('fs-extra');
const path = require('path');
const tmp = require('tmp');
const { ExtensionRootDir } = require('../constants');
const download = require('download');
const StreamZip = require('node-stream-zip');

async function unzip(zipFile, targetFolder) {
    await fs.ensureDir(targetFolder);
    return new Promise((resolve, reject) => {
        const zip = new StreamZip({
            file: zipFile,
            storeEntries: true
        });
        zip.on('ready', async () => {
            zip.extract('extension', targetFolder, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
                zip.close();
            });
        });
    });
}

async function downloadRendererExtension() {
    console.log('Downloading Renderer extension...');
    const extensionName = 'ms-notebook-renderers.vsix';
    const uri = `https://pvsc.blob.core.windows.net/extension-builds-jupyter-public/ms-notebook-renderers.vsix`;
    let cleanup;
    try {
        const downloadDir = await new Promise((resolve, reject) => {
            tmp.dir((err, dir, clean) => {
                cleanup = clean;
                if (err) {
                    return reject(err);
                }
                resolve(dir);
            });
        });

        const downloadedFile = path.join(downloadDir, extensionName);
        if (fs.existsSync(downloadedFile)) {
            await fs.unlink(downloadedFile);
        }
        await download(uri, downloadDir, { filename: extensionName });
        console.log('Downloaded Renderer extension');

        console.log('Extracting Renderer extension');
        const extensionDir = path.join(downloadDir, 'extensionDir');
        await unzip(downloadedFile, extensionDir);
        console.log('Extracted Renderer extension');

        await fs.copy(
            path.join(extensionDir, 'out', 'client_renderer'),
            path.join(ExtensionRootDir, 'out', 'client_renderer')
        );
        console.log('Copied Renderer extension output.');
    } finally {
        if (typeof cleanup == 'function') {
            try {
                cleanup();
            } catch {
                // Don't care if tmp directory wasn't deleted.
            }
        }
    }
}

exports.downloadRendererExtension = downloadRendererExtension;
