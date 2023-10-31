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
