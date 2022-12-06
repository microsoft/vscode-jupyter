// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs-extra');
const path = require('path');
const { startJupyter } = require('./preLaunchWebTest');
const jsonc = require('jsonc-parser');

const settingsFile = path.join(__dirname, '..', 'src', 'test', 'datascience', '.vscode', 'settings.json');
async function go() {
    let url = process.env.EXISTING_JUPYTER_URI;
    if (!url) {
        const info = await startJupyter(true);
        url = info.url;
        fs.writeFileSync(path.join(__dirname, '..', 'temp', 'jupyter.pid'), info.server.pid.toString());
    } else {
        console.log('Jupyter server URL provided in env args, no need to start one');
    }
    const settingsJson = fs.readFileSync(settingsFile).toString();
    const edits = jsonc.modify(settingsJson, ['jupyter.DEBUG_JUPYTER_SERVER_URI'], url, {});
    const updatedSettingsJson = jsonc.applyEdits(settingsJson, edits);
    fs.writeFileSync(settingsFile, updatedSettingsJson);
    process.exit(0);
}
void go();
