// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const path = require('path');
const test_web = require('@vscode/test-web');
const jupyterServer = require('../out/test/datascience/jupyterServer.node');
const fs = require('fs-extra');

async function go() {
    try {
        // Need to start jupyter here before starting the test as it requires node to start it.
        const uri = await jupyterServer.JupyterServer.instance.startJupyterWithToken();

        // Use this token to write to the bundle so we can transfer this into the test.
        const bundlePath = path.join(extensionDevelopmentPath, 'out', 'extension.web.bundle');
        if (await fs.pathExists(bundlePath)) {
            const bundleContents = await fs.readFile(bundlePath, { encoding: 'utf-8' });
            const newContents = bundleContents.replace('TOBEREPLACED_WITHURI', uri.toString());
            await fs.writeFile(bundlePath, newContents);
        }

        // Now run the test
        const extensionDevelopmentPath = path.resolve(__dirname, '../');
        await test_web.runTests({
            browserType: 'chromium',
            verbose: true,
            extensionDevelopmentPath,
            extensionTestsPath: bundlePath
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}
void go();
