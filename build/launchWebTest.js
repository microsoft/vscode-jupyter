// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const path = require('path');
const test_web = require('@vscode/test-web');
async function go() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../');
        await test_web.runTests({
            browserType: 'chromium',
            extensionDevelopmentPath,
            extensionTestsPath: path.join(extensionDevelopmentPath, 'out', 'extension.web.bundle')
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}
void go();
