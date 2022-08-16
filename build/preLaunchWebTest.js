// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require('path');
const jupyterServer = require('../out/test/datascience/jupyterServer.node');
const fs = require('fs-extra');

exports.startJupyter = async function startJupyter(detached) {
    const server = jupyterServer.JupyterServer.instance;
    // Need to start jupyter here before starting the test as it requires node to start it.
    const uri = await server.startJupyterWithToken({ detached });

    // Use this token to write to the bundle so we can transfer this into the test.
    const extensionDevelopmentPath = path.resolve(__dirname, '../');
    const bundlePath = path.join(extensionDevelopmentPath, 'out', 'extension.web.bundle');
    const bundleFile = `${bundlePath}.js`;
    if (await fs.pathExists(bundleFile)) {
        const bundleContents = await fs.readFile(bundleFile, { encoding: 'utf-8' });
        const newContents = bundleContents.replace(
            /^exports\.JUPYTER_SERVER_URI = '(.*)';$/gm,
            `exports.JUPYTER_SERVER_URI = '${uri.toString()}';`
        );
        if (newContents === bundleContents) {
            throw new Error('JUPYTER_SERVER_URI in bundle not updated');
        }
        await fs.writeFile(bundleFile, newContents);
    }
    return { server, url: uri.toString() };
};
