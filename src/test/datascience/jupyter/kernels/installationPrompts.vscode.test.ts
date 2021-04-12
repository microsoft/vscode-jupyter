// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import { IVSCodeNotebook } from '../../../../client/common/application/types';
import { ProductNames } from '../../../../client/common/installer/productNames';
import { BufferDecoder } from '../../../../client/common/process/decoder';
import { ProcessService } from '../../../../client/common/process/proc';
import { IDisposable, IInstaller, InstallerResponse, Product } from '../../../../client/common/types';
import { createDeferred } from '../../../../client/common/utils/async';
import { Common, DataScience } from '../../../../client/common/utils/localize';
import { INotebookEditorProvider } from '../../../../client/datascience/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
// import { IS_CI_SERVER } from '../../../ciConstants';
import { getOSType, IExtensionTestApi, OSType, waitForCondition } from '../../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { closeActiveWindows, initialize } from '../../../initialize';
import { openNotebook } from '../../helpers';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    runAllCellsInActiveNotebook,
    hijackPrompt,
    waitForCellExecutionToComplete,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToChange,
    waitForKernelToGetAutoSelected
} from '../../notebook/helper';

/* eslint-disable no-invalid-this, , , @typescript-eslint/no-explicit-any */
suite('DataScience Install IPyKernel (slow) (install)', function () {
    const disposables: IDisposable[] = [];
    let nbFile: string;
    const templateIPynbFile = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src/test/datascience/jupyter/kernels/nbWithKernel.ipynb'
    );
    const executable = getOSType() === OSType.Windows ? 'Scripts/python.exe' : 'bin/python'; // If running locally on Windows box.
    let venvPythonPath = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvnokernel', executable);
    let venvNoRegPath = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvnoreg', executable);
    const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

    let api: IExtensionTestApi;
    let editorProvider: INotebookEditorProvider;
    let installer: IInstaller;
    let vscodeNotebook: IVSCodeNotebook;
    const delayForUITest = 30_000;
    this.timeout(60_000); // Slow test, we need to uninstall/install ipykernel.
    /*
    This test requires a virtual environment to be created & registered as a kernel.
    It also needs to have ipykernel installed in it.
    */
    suiteSetup(async function () {
        // These are slow tests, hence lets run only on linux on CI.
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        if (
            // (IS_CI_SERVER && getOSType() !== OSType.Linux) ||
            !fs.pathExistsSync(venvPythonPath) ||
            !fs.pathExistsSync(venvNoRegPath)
        ) {
            // Virtual env does not exist.
            return this.skip();
        }
        api = await initialize();
        installer = api.serviceContainer.get<IInstaller>(IInstaller);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);

        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const [interpreter1, interpreter2] = await Promise.all([
            interpreterService.getInterpreterDetails(venvPythonPath),
            interpreterService.getInterpreterDetails(venvNoRegPath)
        ]);
        if (!interpreter1 || !interpreter2) {
            throw new Error('Unable to get information for interpreter 1');
        }
        venvPythonPath = interpreter1.path;
        venvNoRegPath = interpreter2.path;
    });

    setup(async function () {
        console.log(`Start test ${this.currentTest?.title}`);
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        nbFile = await createTemporaryNotebook(templateIPynbFile, disposables);
        // Uninstall ipykernel from the virtual env.
        const proc = new ProcessService(new BufferDecoder());
        await proc.exec(venvPythonPath, ['-m', 'pip', 'uninstall', 'ipykernel', '--yes']);
        await closeActiveWindows();
        sinon.restore();
        console.log(`Start Test completed ${this.currentTest?.title}`);
    });
    teardown(async function () {
        console.log(`End test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });

    test('Test Install IPyKernel prompt message', async () => {
        // Confirm the message has not changed.
        assert.ok(
            DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter()
                .format('', ProductNames.get(Product.ipykernel)!)
                .endsWith(expectedPromptMessageSuffix),
            'Message has changed, please update this test'
        );
    });

    [true, false].forEach((which, i) => {
        // Use index on test name as it messes up regex matching
        test(`Ensure prompt is displayed when ipykernel module is not found and it gets installed ${i}`, async function () {
            // Confirm message is displayed & we click 'Install` button.
            const prompt = await hijackPrompt(
                'showErrorMessage',
                { endsWith: expectedPromptMessageSuffix },
                { text: Common.install(), clickImmediately: true },
                disposables
            );
            const installed = createDeferred();
            const interpreterPath = which ? venvPythonPath : venvNoRegPath;
            console.log(`Running ensure prompt and looking for kernel ${interpreterPath}`);

            // Confirm it is installed.
            const showInformationMessage = sinon
                .stub(installer, 'install')
                .callsFake(async function (product: Product) {
                    // Call original method
                    const result: InstallerResponse = await ((installer.install as any).wrappedMethod.apply(
                        installer,
                        arguments
                    ) as Promise<InstallerResponse>);
                    if (product === Product.ipykernel && result === InstallerResponse.Installed) {
                        installed.resolve();
                    }
                    return result;
                });

            try {
                await openNotebook(api.serviceContainer, nbFile);
                // If this is a native notebook, then wait for kernel to get selected.
                if (editorProvider.activeEditor?.type === 'native') {
                    await waitForKernelToChange({ interpreterPath });
                }

                // Run all cells
                editorProvider.activeEditor!.runAllCells();

                // The prompt should be displayed.
                await waitForCondition(
                    async () => prompt.displayed.then(() => true),
                    delayForUITest,
                    'Prompt not displayed'
                );

                // ipykernel should get installed.
                await waitForCondition(
                    async () => installed.promise.then(() => true),
                    delayForUITest,
                    'Prompt not displayed or not installed successfully'
                );

                // If this is a native notebook, then wait for cell to get executed completely (else VSC can hang).
                // This is because extension will attempt to update cells, while tests may have deleted/closed notebooks.
                if (editorProvider.activeEditor?.type === 'native') {
                    const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
                    await waitForExecutionCompletedSuccessfully(cell);
                }
            } finally {
                prompt.dispose();
                showInformationMessage.restore();
            }
        });
    });
    test('Ensure ipykernel install prompt is displayed every time you try to run a cell (VSCode Notebook)', async function () {
        if (!(await canRunNotebookTests()) || IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }

        // Confirm message is displayed & then dismiss the message (so that execution stops due to missing dependency).
        const prompt = await hijackPrompt(
            'showErrorMessage',
            { endsWith: expectedPromptMessageSuffix },
            { dismissPrompt: true },
            disposables
        );

        await openNotebook(api.serviceContainer, nbFile);
        await waitForKernelToGetAutoSelected();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        assert.equal(cell.outputs.length, 0);

        // The prompt should be displayed when we run a cell.
        await runAllCellsInActiveNotebook();
        await waitForCondition(async () => prompt.displayed.then(() => true), delayForUITest, 'Prompt not displayed');

        // Once ipykernel prompt has been dismissed, execution should stop due to missing dependencies.
        await waitForCellExecutionToComplete(cell);

        // Execute notebook once again & we should get another prompted to install ipykernel.
        let previousPromptDisplayCount = prompt.getDisplayCount();
        await runAllCellsInActiveNotebook();
        await waitForCondition(
            async () => prompt.getDisplayCount() > previousPromptDisplayCount,
            delayForUITest,
            'Prompt not displayed second time'
        );

        // Once ipykernel prompt has been dismissed, execution should stop due to missing dependencies.
        await waitForCellExecutionToComplete(cell);

        // Execute a cell this time & we should get yet another prompted to install ipykernel.
        previousPromptDisplayCount = prompt.getDisplayCount();
        await runAllCellsInActiveNotebook();
        await waitForCondition(
            async () => prompt.getDisplayCount() > previousPromptDisplayCount,
            delayForUITest,
            'Prompt not displayed second time'
        );

        // Once ipykernel prompt has been dismissed, execution should stop due to missing dependencies.
        await waitForCellExecutionToComplete(cell);
    });
});
