// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { spawn } from 'child_process';
import glob from 'glob';
import * as path from '../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants.node';

class TestRunner {
    public async start() {
        console.log('Start Test Runner');
        const testFiles = await new Promise<string[]>((resolve, reject) => {
            glob(`**/*perf.test.js`, (error, files) => {
                if (error) {
                    return reject(error);
                }
                resolve(files);
            });
        });

        // warm up with a basic notebook operation before running the tests
        await this.launchTest('notebookCellExecution.perf.test', true);

        testFiles.forEach((file) => this.launchTest(file));
    }

    private async launchTest(testFile: string, warmupRun?: boolean) {
        console.log('Launch tests in test runner');
        await new Promise<void>((resolve, reject) => {
            const env: Record<string, string> = {
                TEST_FILES_SUFFIX: testFile,
                VSC_JUPYTER_CI_TEST_VSC_CHANNEL: 'insiders',
                VSC_JUPYTER_PERF_TEST: '1',
                CODE_TESTS_WORKSPACE: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience'),
                VSC_JUPYTER_WARMUP_RUN: warmupRun ? '1' : '0',
                VSC_JUPYTER_TEST_TIMEOUT: '60000',
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
