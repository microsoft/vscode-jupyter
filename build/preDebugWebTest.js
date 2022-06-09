// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const fs = require('fs-extra');
const path = require('path');
const { startJupyter } = require('./preLaunchWebTest');
const jsonc = require('jsonc-parser');

const settingsFile = path.join(__dirname, '..', 'src', 'test', 'datascience', '.vscode', 'settings.json');
async function go() {
    const { server, url } = await startJupyter(true);
    fs.writeFileSync(path.join(__dirname, '..', 'temp', 'jupyter.pid'), server.pid.toString());
    const settingsJson = fs.readFileSync(settingsFile).toString();
    const edits = jsonc.modify(settingsJson, ['jupyter.DEBUG_JUPYTER_SERVER_URI'], url, {});
    const updatedSettingsJson = jsonc.applyEdits(settingsJson, edits);
    fs.writeFileSync(settingsFile, updatedSettingsJson);
    process.exit(0);
}
void go();
