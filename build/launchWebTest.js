// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const path = require('path');
const test_web = require('@vscode/test-web');
const { startJupyter } = require('./preLaunchWebTest');
async function go() {
    let exitCode = 0;
    let server;
    try {
        server = (await startJupyter()).server;
        const extensionDevelopmentPath = path.resolve(__dirname, '../');
        const bundlePath = path.join(extensionDevelopmentPath, 'out', 'extension.web.bundle');

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
        console.error('Failed to run tests', err);
        exitCode = 1;
    } finally {
        console.error(server);
        if (server) {
            await server.dispose();
        }
    }

    // Not all promises complete. Force exit
    process.exit(exitCode);
}
void go();
