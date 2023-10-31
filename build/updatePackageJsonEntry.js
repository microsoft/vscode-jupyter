// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require('path');
const fs = require('fs-extra');
const jsonc = require('jsonc-parser');

const launchTests = process.argv.includes('--test');
const packageJsonFile = path.join(__dirname, '..', 'package.json');
let settingsJson = fs.readFileSync(packageJsonFile).toString();

if (launchTests) {
    settingsJson = jsonc.applyEdits(settingsJson, jsonc.modify(settingsJson, ['main'], './out/extension.node.js', {}));
    settingsJson = jsonc.applyEdits(
        settingsJson,
        jsonc.modify(settingsJson, ['browser'], './out/extension.web.bundle.js', {})
    );
} else {
    settingsJson = jsonc.applyEdits(settingsJson, jsonc.modify(settingsJson, ['main'], './dist/extension.node.js', {}));
    settingsJson = jsonc.applyEdits(
        settingsJson,
        jsonc.modify(settingsJson, ['browser'], './dist/extension.web.bundle.js', {})
    );
}

fs.writeFileSync(packageJsonFile, settingsJson);
