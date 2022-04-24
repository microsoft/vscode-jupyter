// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const path = require('path');
const test_web = require('@vscode/test-web');
const jupyterServer = require('../out/test/datascience/jupyterServer.node');
const fs = require('fs-extra');

async function go() {
    let exitCode = 0;
    const server = jupyterServer.JupyterServer.instance;
    try {
        // Need to start jupyter here before starting the test as it requires node to start it.
        const uri = await server.startJupyterWithToken();

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
            await fs.writeFile(bundleFile, newContents);
        }

        // Now run the test
        await test_web.runTests({
            browserType: 'chromium',
            verbose: true,
            headless: true, // Set this to false to debug failures
            extensionDevelopmentPath,
            folderPath: path.resolve(__dirname, '..', 'src', 'test', 'datascience'),
            extensionTestsPath: bundlePath
        });
    } catch (err) {
        console.error('Failed to run tests');
        exitCode = 1;
    } finally {
        if (server) {
            await server.dispose();
        }
    }

    // Not all promises complete. Force exit
    process.exit(exitCode);
}
void go();
