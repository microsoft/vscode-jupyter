// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require('path');
const fs = require('fs-extra');
const { nodeModulesToExternalize } = require('./common');

async function bundle() {
    await Promise.all(nodeModulesToExternalize.map(bundleModule));
    console.info('Successfully built.');
}

async function bundleModule(nodeModule) {
    const entry = path.resolve(path.join(__dirname, '..', '..', 'node_modules', nodeModule));
    const outfile = path.resolve(path.join(__dirname, '..', '..', 'out', 'node_modules', `${nodeModule}.js`));
    await fs.ensureDir(path.dirname(outfile));

    await require('esbuild').build({
        entryPoints: [entry],
        bundle: true,
        outfile,
        platform: 'node'
    });
}

exports.bundle = bundle;
// bundle().catch((ex) => console.error(ex));
