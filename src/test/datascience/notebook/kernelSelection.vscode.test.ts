// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import { commands, ConfigurationTarget, QuickInputButtons, Uri, window } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { ProcessService } from '../../../platform/common/process/proc.node';
import { IConfigurationService, IDisposable } from '../../../platform/common/types';
import { IKernelProvider, isLocalConnection, isRemoteConnection } from '../../../kernels/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import {
    getInterpreterHash,
    getNormalizedInterpreterPath
} from '../../../platform/pythonEnvironments/info/interpreter';
import { createEventHandler, IExtensionTestApi, waitForCondition } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { closeActiveWindows, initialize, IS_CI_SERVER } from '../../initialize.node';
import { openNotebook } from '../helpers.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    runAllCellsInActiveNotebook,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToChange,
    waitForKernelToGetAutoSelected,
    waitForOutputs,
    waitForTextOutput,
    defaultNotebookTestTimeout,
    createTemporaryNotebookFromFile,
    hijackCreateQuickPick,
    asPromise
} from './helper.node';
import { getOSType, OSType } from '../../../platform/common/utils/platform';
import { getTextOutputValue } from '../../../kernels/execution/helpers';
import { noop } from '../../core';
import { Commands } from '../../../platform/common/constants';
import { sleep } from '../../../platform/common/utils/async';
import { IControllerLoader, IControllerRegistration, IControllerSelection } from '../../../notebooks/controllers/types';
import { isWeb } from '../../../platform/common/utils/misc';
import { IJupyterServerUriStorage } from '../../../kernels/jupyter/types';

/* eslint-disable no-invalid-this, , , @typescript-eslint/no-explicit-any */
suite('DataScience - VSCode Notebook - Kernel Selection', function () {
    const disposables: IDisposable[] = [];
    const templateIPynbFile = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/notebook/nbWithKernel.ipynb')
    );
    const executable = getOSType() === OSType.Windows ? 'Scripts/python.exe' : 'bin/python'; // If running locally on Windows box.
    const venvNoKernelPython = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvnokernel', executable)
    );
    const venvKernelPython = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvkernel', executable)
    );
    const venvNoRegPath = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvnoreg', executable)
    );

    let nbFile1: Uri;
    let api: IExtensionTestApi;
    let activeInterpreterPath: Uri;
    let venvNoKernelPythonPath: Uri;
    let venvKernelPythonPath: Uri;
    let venvNoRegPythonPath: Uri;
    let venvNoKernelDisplayName: string;
    let kernelProvider: IKernelProvider;
    const venvNoKernelSearchString = '.venvnokernel';
    const venvKernelSearchString = '.venvkernel';
    const venvNoRegSearchString = '.venvnoreg';
    let activeInterpreterSearchString = '';
    let vscodeNotebook: IVSCodeNotebook;
    let controllerRegistration: IControllerRegistration;
    let controllerLoader: IControllerLoader;
    let controllerSelection: IControllerSelection;
    let serverUriStorage: IJupyterServerUriStorage;
    let configurationService: IConfigurationService;
    let jupyterServerUri: string | undefined;
    this.timeout(120_000); // Slow test, we need to uninstall/install ipykernel.
    /*
    This test requires a virtual environment to be created & registered as a kernel.
    It also needs to have ipykernel installed in it.
    */
    suiteSetup(async function () {
        this.timeout(120_000);
        // These are slow tests, hence lets run only on linux on CI.
        if (
            (IS_CI_SERVER && getOSType() !== OSType.Linux) ||
            !fs.pathExistsSync(venvNoKernelPython.fsPath) ||
            !fs.pathExistsSync(venvKernelPython.fsPath) ||
            !fs.pathExistsSync(venvNoRegPath.fsPath)
        ) {
            // Virtual env does not exist.
            return this.skip();
        }
        api = await initialize();

        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        serverUriStorage = api.serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage);
        controllerLoader = api.serviceContainer.get<IControllerLoader>(IControllerLoader);
        controllerSelection = api.serviceContainer.get<IControllerSelection>(IControllerSelection);
        configurationService = api.serviceContainer.get<IConfigurationService>(IConfigurationService);

        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }

        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        // Wait for all interpreters so we can make sure we can get details on the paths we have
        await interpreterService.getInterpreters();
        const [activeInterpreter, interpreter1, interpreter2, interpreter3] = await Promise.all([
            interpreterService.getActiveInterpreter(),
            interpreterService.getInterpreterDetails(venvNoKernelPython),
            interpreterService.getInterpreterDetails(venvKernelPython),
            interpreterService.getInterpreterDetails(venvNoRegPath)
        ]);
        if (!activeInterpreter || !interpreter1 || !interpreter2 || !interpreter3) {
            throw new Error('Unable to get information for interpreter 1');
        }
        activeInterpreterPath = activeInterpreter?.uri;
        venvNoKernelPythonPath = interpreter1.uri;
        venvKernelPythonPath = interpreter2.uri;
        venvNoRegPythonPath = interpreter3.uri;
        venvNoKernelDisplayName = interpreter1.displayName || '.venvnokernel';
        activeInterpreterSearchString =
            activeInterpreter.displayName === interpreter1.displayName
                ? venvNoKernelSearchString
                : activeInterpreter.displayName === interpreter2.displayName
                ? venvKernelSearchString
                : activeInterpreter.displayName === interpreter3.displayName
                ? venvNoRegSearchString
                : activeInterpreterPath.fsPath;

        // Ensure IPykernel is in all environments.
        const proc = new ProcessService();
        await Promise.all([
            proc.exec(venvNoKernelPython.fsPath, ['-m', 'pip', 'install', 'ipykernel']),
            proc.exec(venvKernelPython.fsPath, ['-m', 'pip', 'install', 'ipykernel']),
            proc.exec(venvNoRegPythonPath.fsPath, ['-m', 'pip', 'install', 'ipykernel'])
        ]);

        await startJupyterServer();
        jupyterServerUri = await serverUriStorage.getRemoteUri();
        sinon.restore();
    });

    setup(async function () {
        console.log(`Start test ${this.currentTest?.title}`);
        await configurationService.updateSetting(
            'showOnlyOneTypeOfKernel',
            false,
            undefined,
            ConfigurationTarget.Global
        );
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        nbFile1 = await createTemporaryNotebookFromFile(templateIPynbFile, disposables, venvNoKernelDisplayName);
        // Update hash in notebook metadata.
        fs.writeFileSync(
            nbFile1.fsPath,
            fs
                .readFileSync(nbFile1.fsPath)
                .toString('utf8')
                .replace('<hash>', getInterpreterHash({ uri: venvNoKernelPythonPath }))
        );
        await closeActiveWindows();
        sinon.restore();
        console.log(`Start Test completed ${this.currentTest?.title}`);
    });
    teardown(async function () {
        console.log(`End test ${this.currentTest?.title}`);
        await configurationService.updateSetting(
            'showOnlyOneTypeOfKernel',
            false,
            undefined,
            ConfigurationTarget.Global
        );
        await closeNotebooksAndCleanUpAfterTests(disposables);
        console.log(`End test completed ${this.currentTest?.title}`);
        if (jupyterServerUri) {
            await serverUriStorage.setUriToRemote(jupyterServerUri, '');
        }
    });

    test('Ensure we select active interpreter as kernel (when Raw Kernels)', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        // Run all cells
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedSuccessfully(cell)]);

        await waitForCondition(
            async () => {
                // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
                const output = getTextOutputValue(cell.outputs[0]);
                if (
                    !output.includes(activeInterpreterSearchString) &&
                    !output.includes(getNormalizedInterpreterPath(activeInterpreterPath).fsPath) &&
                    !output.includes(activeInterpreterPath.fsPath)
                ) {
                    assert.fail(
                        output,
                        `Expected ${getNormalizedInterpreterPath(activeInterpreterPath)} or ${activeInterpreterPath}`,
                        `Interpreter does not match for ${activeInterpreterSearchString}: expected ${getNormalizedInterpreterPath(
                            activeInterpreterPath
                        )} or ${activeInterpreterPath}, but go ${output}`
                    );
                }
                return true;
            },
            defaultNotebookTestTimeout,
            `Interpreter does not match for ${activeInterpreterSearchString}: expected ${getNormalizedInterpreterPath(
                activeInterpreterPath
            )} or ${activeInterpreterPath}, but go ${getTextOutputValue(cell.outputs[0])}`
        );
    });
    test('Ensure kernel is auto selected and interpreter is as expected', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await openNotebook(nbFile1);
        await waitForKernelToGetAutoSelected(undefined);

        // Run all cells
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell),
            // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
            waitForTextOutput(cell, venvNoKernelSearchString, 0, false)
        ]);
    });
    test('Ensure we select a Python kernel for a nb with python language information', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await createEmptyPythonNotebook(disposables);

        // Run all cells
        await insertCodeCell('import sys\nsys.executable', { index: 0 });
        await insertCodeCell('print("Hello World")', { index: 1 });

        const cell1 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.notebook.getCells()![1]!;

        // If it was successfully selected, then we know a Python kernel was correctly selected & managed to run the code.
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionCompletedSuccessfully(cell2)
        ]);
        await waitForTextOutput(cell2, 'Hello World', 0, false);
    });
    test('User kernelspec in notebook metadata', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await openNotebook(nbFile1);
        await waitForKernelToGetAutoSelected(undefined);

        // Run all cells
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell),
            // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
            waitForTextOutput(cell, venvNoKernelSearchString, 0, false)
        ]);

        // Change kernel
        await waitForKernelToChange({ interpreterPath: venvKernelPythonPath });

        // Clear the cells & execute again
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedSuccessfully(cell)]);

        // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
        await waitForTextOutput(cell, venvKernelSearchString, 0, false);
    });
    test('Switch kernel to an interpreter that is registered as a kernel', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        // Run all cells
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell),
            waitForOutputs(cell, 1)
        ]);

        // Confirm the executable printed is not venvkernel
        assert.ok(cell.outputs.length);
        const outputText = getTextOutputValue(cell.outputs[0]).trim();

        // venvkernel might be the active one (if this test is run more than once)
        if (activeInterpreterSearchString !== venvKernelSearchString) {
            assert.equal(outputText.toLowerCase().indexOf(venvKernelSearchString), -1);
        }

        // Very this kernel gets disposed when we switch the notebook kernel.
        const kernel = kernelProvider.get(window.activeNotebookEditor!.notebook)!;
        assert.ok(kernel, 'Kernel is not defined');
        const eventListener = createEventHandler(kernel, 'onDisposed');

        // Change kernel to the interpreter venvkernel
        await waitForKernelToChange({ interpreterPath: venvKernelPythonPath });

        // Verify the old kernel is disposed.
        await eventListener.assertFired(5_000);

        // Clear the cells & execute again
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell),
            // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
            waitForTextOutput(cell, venvKernelSearchString, 0, false)
        ]);

        // Verify the new kernel is not the same as the old.
        assert.isFalse(
            kernel === kernelProvider.get(window.activeNotebookEditor!.notebook),
            'Kernels should not be the same'
        );
    });
    test('Switch kernel to an interpreter that is not registered as a kernel', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        // Run all cells
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell),
            waitForOutputs(cell, 1)
        ]);

        // Confirm the executable printed is not venvNoReg
        assert.ok(cell.outputs.length);
        const outputText = getTextOutputValue(cell.outputs[0]).trim();
        assert.equal(outputText.toLowerCase().indexOf(venvNoRegSearchString), -1);

        // Change kernel to the interpreter venvNoReg
        await waitForKernelToChange({ interpreterPath: venvNoRegPythonPath });

        // Clear the cells & execute again
        commands.executeCommand('notebook.clearAllCellsOutputs').then(noop, noop);
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell),
            // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
            waitForTextOutput(cell, venvNoRegSearchString, 0, false)
        ]);
    });

    async function verifyExpectedCounts(localIsExpected: boolean) {
        await controllerLoader.loaded;
        const remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        const locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));

        if (localIsExpected) {
            assert.ok(locals.length > 1, 'Expected at least two local controller');
            assert.ok(remotes.length <= 1, 'Expected at most one remote controller');
        } else {
            assert.ok(locals.length <= 1, 'Expected at most one local controller');
            assert.ok(remotes.length >= 1, 'Expected at least one remote controller');
        }
    }

    async function changeShowOnlyOneTypeOfKernel(setting: boolean) {
        const settings = configurationService.getSettings();
        if (settings.showOnlyOneTypeOfKernel !== setting) {
            await configurationService.updateSetting(
                'showOnlyOneTypeOfKernel',
                setting,
                undefined,
                ConfigurationTarget.Global
            );
        }
    }

    test('Start local, pick remote second level and go back - locals should be shown', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await changeShowOnlyOneTypeOfKernel(true);
        await serverUriStorage.setUriToLocal();
        await controllerLoader.loaded;
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        // We should start off with locals
        assert.ok(locals.length > 0, 'No locals found');

        // Hijack the quick pick so we can force picking back
        const { created } = await hijackCreateQuickPick(disposables);
        const firstPromise = asPromise(created, undefined, 5000, 'first:back');

        // Execute the command but don't wait for it
        const commandPromise = commands.executeCommand(Commands.SwitchToRemoteKernels) as Promise<void>;

        // URI quick pick should be on the screen.
        let uriQuickPick = await firstPromise;

        // Trigger the selection of the first URI (should be our remote URI)
        const secondPromise = asPromise(created, undefined, 5000, 'second:back');
        uriQuickPick.selectIndex(0);

        // Wait for the 'remote' list to show up
        const remoteQuickPick = await secondPromise;
        await controllerLoader.loaded;

        // At this point we should have remote kernels
        let remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        assert.ok(remotes.length > 0, 'No remote kernels found');

        // Trigger the back button on the remote list
        const thirdPromise = asPromise(created, undefined, 5000, 'third:back');
        remoteQuickPick.triggerButton(QuickInputButtons.Back);

        // That should bring up the URI list again
        uriQuickPick = await thirdPromise;

        // Trigger back on that
        uriQuickPick.triggerButton(QuickInputButtons.Back);

        // Wait for the command to complete
        const result = await Promise.race([commandPromise, sleep(5000)]);
        assert.notOk(result, `Back button did not finish the command`);

        // Make sure our kernel list is only locals
        await verifyExpectedCounts(true);
    });

    test('Start local, pick remote - remotes should be shown', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await changeShowOnlyOneTypeOfKernel(true);
        await serverUriStorage.setUriToLocal();
        await controllerLoader.loaded;
        const notebook = await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        // We should start off with locals
        assert.ok(locals.length > 0, 'No locals found');

        // Hijack the quick pick so we can force picking back
        const { created } = await hijackCreateQuickPick(disposables);
        const firstPromise = asPromise(created, undefined, 5000, 'first:back');

        // Execute the command but don't wait for it
        const commandPromise = commands.executeCommand(Commands.SwitchToRemoteKernels) as Promise<void>;

        // URI quick pick should be on the screen.
        let uriQuickPick = await firstPromise;

        // Trigger the selection of the first URI (should be our remote URI)
        const secondPromise = asPromise(created, undefined, 5000, 'second:back');
        uriQuickPick.selectIndex(0);

        // Wait for the 'remote' list to show up
        const remoteQuickPick = await secondPromise;
        await controllerLoader.loaded;

        // At this point we should have remote kernels
        let remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        assert.ok(remotes.length > 0, 'No remote kernels found');

        // Pick a remote kernel
        remoteQuickPick.selectLastItem();

        // Wait for the command to complete
        const selectionChanged = asPromise(controllerSelection.onControllerSelected);
        const result = await Promise.race([commandPromise, sleep(5000)]);
        assert.notOk(result, `Picking remote did not complete`);

        // Make sure our kernel list is remotes
        await verifyExpectedCounts(false);

        // Make sure the selected kernel is remote
        await selectionChanged;
        const selected = controllerSelection.getSelected(notebook);
        assert.ok(selected, 'Remote kernel was not selected');
        assert.ok(isRemoteConnection(selected!.connection), 'Selected kernel is not remote');
    });

    test('Start local, pick remote first level and go back - locals should be shown', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await changeShowOnlyOneTypeOfKernel(true);
        await serverUriStorage.setUriToLocal();
        await controllerLoader.loaded;
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        // We should start off with locals
        assert.ok(locals.length > 0, 'No locals found');

        // Hijack the quick pick so we can force picking back
        const { created } = await hijackCreateQuickPick(disposables);
        const firstPromise = asPromise(created, undefined, 5000, 'first:back');

        // Execute the command but don't wait for it
        const commandPromise = commands.executeCommand(Commands.SwitchToRemoteKernels) as Promise<void>;

        // URI quick pick should be on the screen.
        let uriQuickPick = await firstPromise;

        // Trigger the back button on the uri list
        uriQuickPick.triggerButton(QuickInputButtons.Back);

        // Wait for the command to complete
        const result = await Promise.race([commandPromise, sleep(5000)]);
        assert.notOk(result, `Back button did not finish the command`);

        // Make sure our kernel list is only locals
        await verifyExpectedCounts(true);
    });

    test('Start local, pick remote and cancel - locals should be shown', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await changeShowOnlyOneTypeOfKernel(true);
        await serverUriStorage.setUriToLocal();
        await controllerLoader.loaded;
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        // We should start off with locals
        assert.ok(locals.length > 0, 'No locals found');

        // Hijack the quick pick so we can force picking back
        const { created } = await hijackCreateQuickPick(disposables);
        const firstPromise = asPromise(created, undefined, 5000, 'first:cancel');

        // Execute the command but don't wait for it
        const commandPromise = commands.executeCommand(Commands.SwitchToRemoteKernels) as Promise<void>;

        // URI quick pick should be on the screen.
        let uriQuickPick = await firstPromise;

        // Trigger the selection of the first URI (should be our remote URI)
        const secondPromise = asPromise(created, undefined, 5000, 'second:cancel');
        uriQuickPick.selectIndex(0);

        // Wait for the 'remote' list to show up
        const remoteQuickPick = await secondPromise;
        await controllerLoader.loaded;

        // At this point we should have remote kernels
        let remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        assert.ok(remotes.length > 0, 'No remote kernels found');

        // Trigger a cancel
        remoteQuickPick.hide();

        // Wait for the command to complete
        const result = await Promise.race([commandPromise, sleep(5000)]);
        assert.notEqual(result, 5000, `Cancel button did not finish the command`);

        // Make sure our kernel list is only locals
        await verifyExpectedCounts(true);
    });
    test('Start remote, pick local and cancel - remotes should be shown', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await changeShowOnlyOneTypeOfKernel(true);
        await controllerLoader.loaded;
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        let remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        // We should start off with remotes
        assert.ok(remotes.length > 0, 'No remotes found');

        // Hijack the quick pick so we can force picking back
        const { created } = await hijackCreateQuickPick(disposables);
        const firstPromise = asPromise(created, undefined, 5000, 'first:cancel');

        // Execute the command but don't wait for it
        const commandPromise = commands.executeCommand(Commands.SwitchToLocalKernels) as Promise<void>;

        // Locals quick pick should be on the first screen
        let localsQuickPick = await firstPromise;
        await controllerLoader.loaded;

        // Should have all locals at the moment
        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        assert.ok(locals.length > 1, 'No local connections');

        // Cancel locals
        localsQuickPick.hide();

        // Wait for the command to complete
        const result = await Promise.race([commandPromise, sleep(5000)]);
        assert.notEqual(result, 5000, `Cancel button did not finish the command`);

        // Make sure our kernel list is only remotes
        await verifyExpectedCounts(false);
    });

    test('Start remote, pick local and back - remotes should be shown', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await changeShowOnlyOneTypeOfKernel(true);
        await controllerLoader.loaded;
        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        let remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        // We should start off with remotes
        assert.ok(remotes.length > 0, 'No remotes found');

        // Hijack the quick pick so we can force picking back
        const { created } = await hijackCreateQuickPick(disposables);
        const firstPromise = asPromise(created, undefined, 5000, 'first:cancel');

        // Execute the command but don't wait for it
        const commandPromise = commands.executeCommand(Commands.SwitchToLocalKernels) as Promise<void>;

        // Locals quick pick should be on the first screen
        let localsQuickPick = await firstPromise;
        await controllerLoader.loaded;

        // Should have all locals at the moment
        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        assert.ok(locals.length > 0, 'No local connections');

        // Hit back
        localsQuickPick.triggerButton(QuickInputButtons.Back);

        // Wait for the command to complete
        const result = await Promise.race([commandPromise, sleep(5000)]);
        assert.notEqual(result, 5000, `Cancel button did not finish the command`);

        // Make sure our kernel list is only remotes
        await verifyExpectedCounts(false);
    });
    test('Start remote, pick local. Make sure it is picked', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await changeShowOnlyOneTypeOfKernel(true);
        await controllerLoader.loaded;
        const notebook = await createEmptyPythonNotebook(disposables);
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        let remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        // We should start off with remotes
        assert.ok(remotes.length > 0, 'No remotes found');

        // Hijack the quick pick so we can force picking back
        const { created } = await hijackCreateQuickPick(disposables);
        const firstPromise = asPromise(created, undefined, 5000, 'first:cancel');

        // Execute the command but don't wait for it
        const commandPromise = commands.executeCommand(Commands.SwitchToLocalKernels) as Promise<void>;

        // Locals quick pick should be on the first screen
        let localsQuickPick = await firstPromise;
        await controllerLoader.loaded;

        // Should have all locals at the moment
        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        assert.ok(locals.length > 1, 'No local connections');

        // Pick a local connection
        localsQuickPick.selectLastItem();

        // Wait for the command to complete
        const selectionChanged = asPromise(controllerSelection.onControllerSelected);
        const result = await Promise.race([commandPromise, sleep(5000)]);
        assert.notEqual(result, 5000, `Cancel button did not finish the command`);

        // Make sure our kernel list is only locals
        await verifyExpectedCounts(true);
        await selectionChanged;
        const selected = controllerSelection.getSelected(notebook);
        assert.ok(selected, 'Local kernel was not selected');
        assert.ok(isLocalConnection(selected!.connection), 'Selected kernel is not local');
    });

    test('Start show both types of kernels and then switch', async function () {
        if (!IS_REMOTE_NATIVE_TEST() || isWeb()) {
            this.skip(); // Test only works when have a remote server mode and we can connect to locals
        }
        await controllerLoader.loaded;
        let locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        let remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        // We should start off with locals and remotes
        assert.ok(remotes.length > 0, 'No remotes found');
        assert.ok(locals.length > 0, 'No locals found');

        // Switch to remote only
        await changeShowOnlyOneTypeOfKernel(true);
        locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        assert.ok(remotes.length > 0, 'No remotes found in single mode');
        assert.ok(locals.length === 0, 'Locals found in single mode');

        // Force to local
        await serverUriStorage.setUriToLocal();
        await controllerLoader.loaded;
        locals = controllerRegistration.registered.filter((c) => isLocalConnection(c.connection));
        remotes = controllerRegistration.registered.filter((c) => isRemoteConnection(c.connection));
        assert.ok(remotes.length === 0, 'Remotes found in single mode');
        assert.ok(locals.length > 0, 'No locals found in single mode');
    });
});
