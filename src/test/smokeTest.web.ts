import * as path from 'path';
import { runTests } from '@vscode/test-web';

async function go() {
    try {
        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to module with the test runner and tests
        const extensionTestsPath = path.resolve(__dirname, './smoke.test/index.web.bundle');

        // Start a web server that serves VSCode in a browser, run the tests
        await runTests({
            browserType: 'chromium',
            extensionDevelopmentPath,
            extensionTestsPath
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

void go();
