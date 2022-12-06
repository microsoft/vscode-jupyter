// Copyright (c) Microsoft Corporation.
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
        console.log(`Launching warmup test for initial VS Code startup`);
        await this.launchTest('notebookCellExecution.perf.test', true);

        testFiles.forEach(async (file) => {
            const fileName = path.basename(file, '.js');
            console.log(`Launching test for file: ${fileName}`);
            await this.launchTest(fileName);
        });
    }

    private async launchTest(testFile: string, warmupRun?: boolean) {
        console.log(`Launch bootstrapper for ${warmupRun ? 'warmup ' : ''}test run`);
        await new Promise<void>((resolve, reject) => {
            const env: Record<string, string> = {
                TEST_FILES_SUFFIX: testFile,
                VSC_JUPYTER_CI_TEST_VSC_CHANNEL: 'insiders',
                VSC_JUPYTER_PERF_TEST: '1',
                CODE_TESTS_WORKSPACE: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience'),
                VSC_JUPYTER_WARMUP_RUN: warmupRun ? '1' : '0',
                VSC_JUPYTER_TEST_TIMEOUT: '120000',
                ...process.env
            };
            const proc = spawn(
                'node',
                [path.join(__dirname, 'testBootstrap.node.js'), path.join(__dirname, 'standardTest.node.js')],
                {
                    cwd: EXTENSION_ROOT_DIR_FOR_TESTS,
                    env
                }
            );
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
    console.error('Error in running Perf Tests', ex);
    process.exit(1);
});
