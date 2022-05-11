// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable no-console, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

// Must always be on top to setup expected env.
process.env.VSC_JUPYTER_SMOKE_TEST = '1';

import { spawn } from 'child_process';
import * as path from '../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants.node';

class TestRunner {
    public async start() {
        console.log('Start Test Runner');
        await this.launchTest();
    }

    private async launchTest() {
        console.log('Launch tests in test runner');
        await new Promise<void>((resolve, reject) => {
            const env: Record<string, string> = {
                TEST_FILES_SUFFIX: 'notebookCellExecution.perf.test',
                VSC_JUPYTER_PERF_TEST: '1',
                CODE_TESTS_WORKSPACE: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience'),
                ...process.env
            };
            const proc = spawn('node', [path.join(__dirname, 'standardTest.node.js')], {
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
}

new TestRunner().start().catch((ex) => {
    console.error('Error in running Smoke Tests', ex);
    // Exit with non zero exit code, so CI fails.
    process.exit(1);
});
