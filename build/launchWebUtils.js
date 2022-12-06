// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require('path');
const fs = require('fs-extra');
const test_web = require('@vscode/test-web');
const { startJupyter } = require('./preLaunchWebTest');
const jsonc = require('jsonc-parser');
const { startReportServer } = require('./webTestReporter');
const { noop } = require('../out/test/core');
const { isCI } = require('./constants');
const extensionDevelopmentPath = path.resolve(__dirname, '../');
const packageJsonFile = path.join(extensionDevelopmentPath, 'package.json');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;

const browserType = argv.browser || argv.browserType || 'chromium';
const port = argv.port || 3000;

exports.launch = async function launch(launchTests) {
    let exitCode = 0;
    let server;
    let testServer;
    try {
        if (launchTests) {
            server = (await startJupyter()).server;
            testServer = await startReportServer();
        }
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
        const options = {
            browserType,
            verbose: true,
            port,
            headless: isCI ? false : false, // Set this to false to debug failures (false on CI to support capturing screenshots when tests fail).
            extensionDevelopmentPath,
            folderPath: path.resolve(__dirname, '..', 'src', 'test', 'datascience')
        };
        if (launchTests) {
            options.extensionTestsPath = bundlePath;
        }
        await test_web.runTests(options);
    } catch (err) {
        console.error(launchTests ? 'Failed to run tests' : 'Failed to launch VS Code', err);
        exitCode = 1;
    } finally {
        if (testServer) {
            await testServer.dispose().catch(noop);
        }
        if (server) {
            await server.dispose();
        }
    }

    // Not all promises complete. Force exit
    process.exit(exitCode);
};
