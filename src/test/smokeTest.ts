// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable no-console, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

// Must always be on top to setup expected env.
process.env.VSC_JUPYTER_SMOKE_TEST = '1';

import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { unzip } from './common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, SMOKE_TEST_EXTENSIONS_DIR } from './constants';

class TestRunner {
    public async start() {
        console.log('Start Test Runner');
        await this.enableLanguageServer(true);
        await this.extractLatestExtension(SMOKE_TEST_EXTENSIONS_DIR);
        await this.launchSmokeTests();
    }
    private async launchSmokeTests() {
        const env: Record<string, {}> = {
            VSC_JUPYTER_SMOKE_TEST: '1',
            CODE_EXTENSIONS_PATH: SMOKE_TEST_EXTENSIONS_DIR
        };

        await this.launchTest(env);
    }
    private async enableLanguageServer(enable: boolean) {
        // When running smoke tests, we won't have access to unbundled files.
        const settings = `{ "python.languageServer": ${enable ? '"Microsoft"' : '"Jedi"'} }`;
        await fs.ensureDir(
            path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'smokeTests', '.vscode')
        );
        await fs.writeFile(
            path.join(
                EXTENSION_ROOT_DIR_FOR_TESTS,
                'src',
                'testMultiRootWkspc',
                'smokeTests',
                '.vscode',
                'settings.json'
            ),
            settings
        );
    }
    private async launchTest(customEnvVars: Record<string, {}>) {
        console.log('Launch tests in test runner');
        await new Promise((resolve, reject) => {
            const env: Record<string, string> = {
                TEST_FILES_SUFFIX: 'smoke.test',
                IS_SMOKE_TEST: 'true',
                CODE_TESTS_WORKSPACE: path.join(
                    EXTENSION_ROOT_DIR_FOR_TESTS,
                    'src',
                    'testMultiRootWkspc',
                    'smokeTests'
                ),
                ...process.env,
                ...customEnvVars
            };
            const proc = spawn('node', [path.join(__dirname, 'standardTest.js')], {
                cwd: EXTENSION_ROOT_DIR_FOR_TESTS,
                env
            });
            proc.stdout.pipe(process.stdout);
            proc.stderr.pipe(process.stderr);
            proc.on('error', reject);
            proc.on('exit', (code) => {
                console.log(`Tests Exited with code ${code}`);
                if (code === 0) {
                    resolve();
                } else {
                    reject(`Failed with code ${code}.`);
                }
            });
        });
    }

    private async extractLatestExtension(targetDir: string): Promise<void> {
        const extensionFile = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, process.env.VSIX_NAME!);
        await unzip(extensionFile, targetDir);
    }
}

new TestRunner().start().catch((ex) => {
    console.error('Error in running Smoke Tests', ex);
    // Exit with non zero exit code, so CI fails.
    process.exit(1);
});
