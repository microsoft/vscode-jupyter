// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import { assert } from 'chai';
import { IPythonExtensionChecker } from '../../../client/api/types';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { BufferDecoder } from '../../../client/common/process/decoder';
import { ProcessService } from '../../../client/common/process/proc';
import { IDisposable } from '../../../client/common/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { getOSType, IExtensionTestApi, OSType } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from '../../constants';
import { initialize, IS_CI_SERVER } from '../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    runAllCellsInActiveNotebook,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToChange,
    waitForCellToHaveOutput
} from './helper';
import { traceInfoIfCI } from '../../../client/common/logger';

/* eslint-disable no-invalid-this, , , @typescript-eslint/no-explicit-any */
suite('sys.path in Python Kernels', function () {
    const disposables: IDisposable[] = [];
    const executable = getOSType() === OSType.Windows ? 'Scripts/python.exe' : 'bin/python'; // If running locally on Windows box.
    const venvKernelPython = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvkernel', executable);

    let api: IExtensionTestApi;
    let interpreterInfo: PythonEnvironment;
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000); // Slow test, we need to uninstall/install ipykernel.
    /*
    This test requires a virtual environment to be created & registered as a kernel.
    It also needs to have ipykernel installed in it.
    */
    suiteSetup(async function () {
        this.timeout(120_000);
        // These are slow tests, hence lets run only on linux on CI.
        if (
            IS_REMOTE_NATIVE_TEST ||
            (IS_CI_SERVER && getOSType() !== OSType.Linux) ||
            !fs.pathExistsSync(venvKernelPython)
        ) {
            // Virtual env does not exist.
            return this.skip();
        }
        api = await initialize();

        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);

        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }

        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        // Wait for all interpreters so we can make sure we can get details on the paths we have
        await interpreterService.getInterpreters();
        const [activeInterpreter, interpreter1] = await Promise.all([
            interpreterService.getActiveInterpreter(),
            interpreterService.getInterpreterDetails(venvKernelPython)
        ]);
        if (!activeInterpreter || !interpreter1) {
            throw new Error('Unable to get information for interpreter 1');
        }
        interpreterInfo = interpreter1;
        // Ensure IPykernel is in all environments.
        const proc = new ProcessService(new BufferDecoder());
        await proc.exec(venvKernelPython, ['-m', 'pip', 'install', 'ipykernel']);

        await startJupyterServer();
        sinon.restore();
    });

    setup(async function () {
        console.log(`Start test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        sinon.restore();
        console.log(`Start Test completed ${this.currentTest?.title}`);
    });
    teardown(async function () {
        console.log(`End test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        sinon.restore();
        console.log(`End test completed ${this.currentTest?.title}`);
    });

    test('Ensure global site_packages is at the bottom of syspath in kernel process', async function () {
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.path', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        // Change kernel
        await waitForKernelToChange({ interpreterPath: interpreterInfo.path });
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell),
            waitForCellToHaveOutput(cell)
        ]);

        const output = Buffer.from(cell.outputs[0].items[0].data).toString().trim();
        traceInfoIfCI(`sys.path value is ${output}`);
        const paths: string[] = JSON.parse(output.replace(/'/g, '"'));
        const pythonFilesFolder = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'pythonFiles');
        const filteredPaths = paths.filter((value, i) => {
            // First item in sys.path is the workspace folder.
            if (i === 0) {
                return false;
            }
            if (value.toLowerCase().startsWith(pythonFilesFolder)) {
                return false;
            }
            if (value.trim().length === 0) {
                return false;
            }
            return true;
        });
        // All the paths in sys.path should now be the interpreter paths.
        // After all of that, we should have the global site_pacakges.
        let lastIndexOfEnvironmentPath = -1;
        let firstIndexOfNonEnvPath = -1;
        filteredPaths.forEach((value, index) => {
            value = value.toLowerCase();
            if (!value.includes('site-packages')) {
                return;
            }
            if (value.includes(interpreterInfo.sysPrefix.toLowerCase())) {
                lastIndexOfEnvironmentPath = index;
            } else if (firstIndexOfNonEnvPath === -1) {
                firstIndexOfNonEnvPath = index;
            }
        });

        assert.ok(
            firstIndexOfNonEnvPath > lastIndexOfEnvironmentPath,
            `non-env paths should be after (gut got ${firstIndexOfNonEnvPath} > ${lastIndexOfEnvironmentPath}) the Env Paths in sys.path ${output}`
        );
    });
});
