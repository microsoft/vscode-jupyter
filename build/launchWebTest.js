// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const path = require('path');
const fs = require('fs-extra');
const test_web = require('@vscode/test-web');
const { startJupyter } = require('./preLaunchWebTest');
const jsonc = require('jsonc-parser');
const { startReportServer } = require('./webTestReporter');
const extensionDevelopmentPath = path.resolve(__dirname, '../');
const packageJsonFile = path.join(extensionDevelopmentPath, 'package.json');

async function go() {
    let exitCode = 0;
    let server;
    let testServer;
    try {
        server = (await startJupyter()).server;
        testServer = await startReportServer();
        const bundlePath = path.join(extensionDevelopmentPath, 'out', 'extension.web.bundle');

        // Changing the logging level to be read from workspace settings file.
        // This way we can enable verbose logging and get the logs for web tests.
        const settingsJson = fs.readFileSync(packageJsonFile).toString();
        const edits = jsonc.modify(
            settingsJson,
            ['contributes', 'configuration', 'properties', 'jupyter.logging.level', 'scope'],
            'resource',
            {}
        );
        const updatedSettingsJson = jsonc.applyEdits(settingsJson, edits);
        fs.writeFileSync(packageJsonFile, updatedSettingsJson);

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
        if (testServer) {
            testServer.dispose();
        }
        if (server) {
            await server.dispose();
        }
    }

    // Not all promises complete. Force exit
    process.exit(exitCode);
}
void go();
