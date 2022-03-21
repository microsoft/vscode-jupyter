// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import { commands, Memento, workspace, window, Uri, NotebookCell } from 'vscode';
import { IPythonApiProvider } from '../../../../client/api/types';
import { ICommandManager, IVSCodeNotebook } from '../../../../client/common/application/types';
import { Kernel } from '../../../../client/../kernels/kernel';
import { getDisplayPath } from '../../../../client/common/platform/fs-paths';
import { BufferDecoder } from '../../../../client/common/process/decoder';
import { ProcessService } from '../../../../client/common/process/proc';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposable,
    IMemento,
    IWatchableJupyterSettings,
    ReadWrite
} from '../../../../client/common/types';
import { createDeferred } from '../../../../client/common/utils/async';
import { Common, DataScience } from '../../../../client/common/utils/localize';
import { InteractiveWindowProvider } from '../../../../interactive-window/interactiveWindowProvider';
import { hasErrorOutput, translateCellErrorOutput } from '../../../../notebooks/helpers';
import { IInteractiveWindowProvider } from '../../../../client/datascience/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { areInterpreterPathsSame, getInterpreterHash } from '../../../../client/pythonEnvironments/info/interpreter';
import { captureScreenShot, getOSType, IExtensionTestApi, OSType, waitForCondition } from '../../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from '../../../constants';
import { closeActiveWindows, initialize } from '../../../initialize';
import { openNotebook, submitFromPythonFile } from '../../helpers';
import { JupyterNotebookView } from '../../../../notebooks/constants';
import { INotebookControllerManager } from '../../../../notebooks/types';
import { BaseKernelError, WrappedError } from '../../../../client/../extension/errors/types';
import { Commands } from '../../../../client/datascience/constants';
import { clearInstalledIntoInterpreterMemento } from '../../../../kernels/installer/productInstaller';
import { ProductNames } from '../../../../kernels/installer/productNames';
import { Product, IInstaller, InstallerResponse } from '../../../../kernels/installer/types';
import {
    createTemporaryNotebook,
    closeNotebooksAndCleanUpAfterTests,
    hijackPrompt,
    waitForKernelToGetAutoSelected,
    runAllCellsInActiveNotebook,
    assertVSCCellIsNotRunning,
    defaultNotebookTestTimeout,
    waitForKernelToChange,
    waitForExecutionCompletedSuccessfully,
    getCellOutputs,
    waitForCellHavingOutput,
    insertCodeCell
} from '../../notebook/helper';
import * as kernelSelector from '../../../../notebooks/controllers/kernelSelector';

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
    let venvKernelPath = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvkernel', executable);
    const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} package`;

    let api: IExtensionTestApi;
    let installer: IInstaller;
    let memento: Memento;
    let installerSpy: sinon.SinonSpy;
    let commandManager: ICommandManager;
    let vscodeNotebook: IVSCodeNotebook;
    let controllerManager: INotebookControllerManager;
    const delayForUITest = 120_000;
    this.timeout(120_000); // Slow test, we need to uninstall/install ipykernel.
    let configSettings: ReadWrite<IWatchableJupyterSettings>;
    let previousDisableJupyterAutoStartValue: boolean;
    let interactiveWindowProvider: InteractiveWindowProvider;
    /*
    This test requires a virtual environment to be created & registered as a kernel.
    It also needs to have ipykernel installed in it.
    */
    suiteSetup(async function () {
        // These are slow tests, hence lets run only on linux on CI.
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        if (!fs.pathExistsSync(venvPythonPath) || !fs.pathExistsSync(venvNoRegPath)) {
            // Virtual env does not exist.
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        installer = api.serviceContainer.get<IInstaller>(IInstaller);
        memento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        controllerManager = api.serviceContainer.get<INotebookControllerManager>(INotebookControllerManager);
        const configService = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
        configSettings = configService.getSettings(undefined) as any;
        previousDisableJupyterAutoStartValue = configSettings.disableJupyterAutoStart;
        configSettings.disableJupyterAutoStart = true;
        const pythonApi = await api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider).getApi();
        await pythonApi.refreshInterpreters({ clearCache: true });
        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const [interpreter1, interpreter2, interpreter3] = await Promise.all([
            interpreterService.getInterpreterDetails(venvPythonPath),
            interpreterService.getInterpreterDetails(venvNoRegPath),
            interpreterService.getInterpreterDetails(venvKernelPath)
        ]);
        if (!interpreter1 || !interpreter2 || !interpreter3) {
            throw new Error('Unable to get information for interpreter 1');
        }
        venvPythonPath = interpreter1.path;
        venvNoRegPath = interpreter2.path;
        venvKernelPath = interpreter3.path;
    });
    setup(async function () {
        console.log(`Start test ${this.currentTest?.title}`);
        const configService = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
        configSettings = configService.getSettings(undefined) as any;
        configSettings.disableJupyterAutoStart = true;

        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        nbFile = await createTemporaryNotebook(templateIPynbFile, disposables);
        // Update hash in notebook metadata.
        fs.writeFileSync(
            nbFile,
            fs
                .readFileSync(nbFile)
                .toString('utf8')
                .replace('<hash>', getInterpreterHash({ path: venvPythonPath }))
        );
        await installIPyKernel(venvKernelPath);
        await uninstallIPyKernel(venvPythonPath);
        await closeActiveWindows();
        await Promise.all([
            clearInstalledIntoInterpreterMemento(memento, Product.ipykernel, venvPythonPath),
            clearInstalledIntoInterpreterMemento(memento, Product.ipykernel, venvNoRegPath)
        ]);
        sinon.restore();
        console.log(`Start Test completed ${this.currentTest?.title}`);
    });
    teardown(async function () {
        console.log(`End test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest?.title);
        }
        configSettings.disableJupyterAutoStart = previousDisableJupyterAutoStartValue;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        sinon.restore();
    });
    suiteTeardown(async function () {
        // Make sure to put ipykernel back
        try {
            await installIPyKernel(venvPythonPath);
            await uninstallIPyKernel(venvNoRegPath);
        } catch (ex) {
            // Don't fail test
        }
    });

    test('Test Install IPyKernel prompt message', async () => {
        // Confirm the message has not changed.
        assert.ok(
            DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter()
                .format('', ProductNames.get(Product.ipykernel)!)
                .endsWith(`${expectedPromptMessageSuffix}.`),
            'Message has changed, please update this test'
        );
    });

    test(`Ensure prompt is displayed when ipykernel module is not found and it gets installed for '${path.basename(
        venvPythonPath
    )}'`, async () => openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath));
    test(`Ensure prompt is displayed when ipykernel module is not found and it gets installed for '${path.basename(
        venvNoRegPath
    )}'`, async () => openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath));
    test('Ensure ipykernel install prompt is displayed every time you try to run a cell in a Notebook', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }

        // Confirm message is displayed & then dismiss the message (so that execution stops due to missing dependency).
        const prompt = await hijackPrompt(
            'showInformationMessage',
            { contains: expectedPromptMessageSuffix },
            { dismissPrompt: true },
            disposables
        );

        await openNotebook(nbFile);
        await waitForKernelToGetAutoSelected();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        assert.equal(cell.outputs.length, 0);

        // The prompt should be displayed when we run a cell.
        await runAllCellsInActiveNotebook();
        await waitForCondition(async () => prompt.displayed.then(() => true), delayForUITest, 'Prompt not displayed');

        // Once ipykernel prompt has been dismissed, execution should stop due to missing dependencies.
        await waitForCondition(
            async () =>
                hasErrorOutput(cell.outputs) &&
                assertVSCCellIsNotRunning(cell) &&
                verifyInstallIPyKernelInstructionsInOutput(cell),
            defaultNotebookTestTimeout,
            'No errors in cell (first time)'
        );

        // Execute notebook once again & we should get another prompted to install ipykernel.
        let previousPromptDisplayCount = prompt.getDisplayCount();
        await runAllCellsInActiveNotebook();
        await waitForCondition(
            async () => prompt.getDisplayCount() > previousPromptDisplayCount,
            delayForUITest,
            'Prompt not displayed second time'
        );

        // Once ipykernel prompt has been dismissed, execution should stop due to missing dependencies.
        await waitForCondition(
            async () => hasErrorOutput(cell.outputs) && assertVSCCellIsNotRunning(cell),
            defaultNotebookTestTimeout,
            'No errors in cell (second time)'
        );

        // Execute a cell this time & we should get yet another prompted to install ipykernel.
        previousPromptDisplayCount = prompt.getDisplayCount();
        await runAllCellsInActiveNotebook();
        await waitForCondition(
            async () => prompt.getDisplayCount() > previousPromptDisplayCount,
            delayForUITest,
            'Prompt not displayed second time'
        );

        // Once ipykernel prompt has been dismissed, execution should stop due to missing dependencies.
        await waitForCondition(
            async () => hasErrorOutput(cell.outputs) && assertVSCCellIsNotRunning(cell),
            defaultNotebookTestTimeout,
            'No errors in cell (third time)'
        );
    });
    test('Ensure ipykernel install prompt is displayed every time you try to run a cell in an Interactive Window', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        // Confirm message is displayed & then dismiss the message (so that execution stops due to missing dependency).
        const prompt = await hijackPrompt(
            'showInformationMessage',
            { contains: expectedPromptMessageSuffix },
            { dismissPrompt: true },
            disposables
        );
        const pythonApiProvider = api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider);
        const source = 'print(__file__)';
        const { activeInteractiveWindow } = await submitFromPythonFile(
            interactiveWindowProvider,
            source,
            disposables,
            pythonApiProvider,
            venvPythonPath
        );
        const notebookDocument = workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        )!;

        // The prompt should be displayed when we run a cell.
        await waitForCondition(async () => prompt.displayed.then(() => true), delayForUITest, 'Prompt not displayed');

        const cell = notebookDocument.cellAt(0)!;
        assert.equal(cell.outputs.length, 0);

        // Once ipykernel prompt has been dismissed, execution should stop due to missing dependencies.
        await waitForCondition(
            async () => assertVSCCellIsNotRunning(cell),
            defaultNotebookTestTimeout,
            'No errors in cell'
        );

        // Prompt should only be displayed once
        assert.equal(prompt.getDisplayCount(), 1, 'Display prompt shown more than once');
    });
    test('Ensure ipykernel install prompt is displayed even after uninstalling ipykernel (VSCode Notebook)', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }

        // Verify we can open a notebook, run a cell and ipykernel prompt should be displayed.
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath);
        await closeNotebooksAndCleanUpAfterTests();

        // Un-install IpyKernel
        await uninstallIPyKernel(venvPythonPath);

        nbFile = await createTemporaryNotebook(templateIPynbFile, disposables);
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath);
    });
    test('Ensure ipykernel install prompt is displayed even selecting another kernel which too does not have IPyKernel installed (VSCode Notebook)', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }

        // Verify we can open a notebook, run a cell and ipykernel prompt should be displayed.
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath);
        await closeNotebooksAndCleanUpAfterTests();

        // Un-install IpyKernel
        await uninstallIPyKernel(venvPythonPath);
        await uninstallIPyKernel(venvNoRegPath);

        nbFile = await createTemporaryNotebook(templateIPynbFile, disposables);
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath, venvNoRegPath);
    });
    test('Ensure ipykernel install prompt is not displayed after selecting another kernel which has IPyKernel installed (VSCode Notebook)', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }

        // Verify we can open a notebook, run a cell and ipykernel prompt should be displayed.
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath);
        await closeNotebooksAndCleanUpAfterTests();

        // Un-install IpyKernel
        await uninstallIPyKernel(venvPythonPath);
        await installIPyKernel(venvNoRegPath);

        nbFile = await createTemporaryNotebook(templateIPynbFile, disposables);
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath, venvNoRegPath, 'DoNotInstallIPyKernel');
    });
    test('Should be prompted to re-install ipykernel when restarting a kernel from which ipykernel was uninstalled (VSCode Notebook)', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }

        // Verify we can open a notebook, run a cell and ipykernel prompt should be displayed.
        console.log('Step1');
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath);

        // Un-install IpyKernel
        console.log('Step2');
        await uninstallIPyKernel(venvPythonPath);

        // Now that IPyKernel is missing, if we attempt to restart a kernel, we should get a prompt.
        // Previously things just hang at weird spots, its not a likely scenario, but this test ensures the code works as expected.

        // Confirm message is displayed.
        installerSpy = sinon.spy(installer, 'install');
        console.log('Step3');
        const promptToInstall = await clickInstallFromIPyKernelPrompt();
        await commandManager.executeCommand(Commands.RestartKernel, {
            notebookEditor: { notebookUri: Uri.file(nbFile) }
        }),
            console.log('Step4');
        await Promise.all([
            waitForCondition(
                async () => promptToInstall.displayed.then(() => true),
                delayForUITest,
                'Prompt not displayed'
            ),
            waitForIPyKernelToGetInstalled()
        ]);
    });
    test('Ensure ipykernel install prompt is displayed and we can select another kernel after uninstalling IPyKernel from a live notebook and then restarting the kernel (VSCode Notebook)', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        // Verify we can open a notebook, run a cell and ipykernel prompt should be displayed.
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath);

        // Un-install IpyKernel
        await uninstallIPyKernel(venvPythonPath);

        // Now that IPyKernel is missing, if we attempt to restart a kernel, we should get a prompt.
        // Previously things just hang at weird spots, its not a likely scenario, but this test ensures the code works as expected.
        const startController = controllerManager.getSelectedNotebookController(
            vscodeNotebook.activeNotebookEditor?.document!
        );
        assert.ok(startController);

        // Confirm message is displayed.
        const promptToInstall = await selectKernelFromIPyKernelPrompt();
        const { kernelSelected } = hookupKernelSelected(promptToInstall, venvNoRegPath);
        await commands.executeCommand(Commands.RestartKernel, nbFile);

        await Promise.all([
            await commandManager.executeCommand(Commands.RestartKernel, {
                notebookEditor: { notebookUri: Uri.file(nbFile) }
            }),
            waitForCondition(
                async () => promptToInstall.displayed.then(() => true),
                delayForUITest,
                'Prompt not displayed'
            ),
            waitForCondition(async () => kernelSelected, delayForUITest, 'New kernel not selected'),
            // Verify the new kernel associated with this notebook is different.
            waitForCondition(
                async () => {
                    const newController = controllerManager.getSelectedNotebookController(
                        vscodeNotebook.activeNotebookEditor?.document!
                    );
                    assert.ok(newController);
                    assert.notEqual(startController?.id, newController!.id);
                    return true;
                },
                delayForUITest,
                'Underlying IKernel should have changed as well'
            )
        ]);
    });
    test('Ensure ipykernel install prompt will switch', async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        // Confirm message is displayed & then dismiss the message (so that execution stops due to missing dependency).
        const prompt = await hijackPrompt(
            'showInformationMessage',
            { contains: expectedPromptMessageSuffix },
            { text: DataScience.selectKernel(), clickImmediately: true },
            disposables
        );

        // Hijack the select kernel functionality so it selects the correct kernel
        const stub = sinon.stub(kernelSelector, 'selectKernel').callsFake(async function () {
            await waitForKernelToChange({ interpreterPath: venvKernelPath });
            return true;
        } as any);
        const disposable = { dispose: () => stub.restore() };
        if (disposables) {
            disposables.push(disposable);
        }

        await openNotebook(nbFile);
        await waitForKernelToGetAutoSelected();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        assert.equal(cell.outputs.length, 0);

        // Insert another cell so we can test run all
        const cell2 = await insertCodeCell('print("foo")');

        // The prompt should be displayed when we run a cell.
        const runPromise = runAllCellsInActiveNotebook();
        await waitForCondition(async () => prompt.displayed.then(() => true), delayForUITest, 'Prompt not displayed');

        // Now the run should finish
        await runPromise;
        await Promise.all([waitForExecutionCompletedSuccessfully(cell), waitForExecutionCompletedSuccessfully(cell2)]);
    });

    test('Ensure ipykernel install prompt is NOT displayed when auto start is enabled & ipykernel is missing (VSCode Notebook)', async function () {
        // Ensure we have auto start enabled, and verify kernel startup fails silently without any notifications.
        // When running a cell we should get an install prompt.
        configSettings.disableJupyterAutoStart = false;
        const promptToInstall = await clickInstallFromIPyKernelPrompt();
        const kernelStartSpy = sinon.spy(Kernel.prototype, 'start');
        console.log('Step1');
        await uninstallIPyKernel(venvPythonPath);
        console.log('Step2');
        await openNotebook(nbFile);
        console.log('Step3');
        await waitForKernelToGetAutoSelected();
        console.log('Step4');
        await waitForCondition(
            async () => kernelStartSpy.callCount > 0,
            delayForUITest,
            'Did not attempt to auto start the kernel'
        );
        console.log('Step5');
        // Wait for kernel startup to fail & verify the error.
        try {
            await kernelStartSpy.getCall(0).returnValue;
            assert.fail('Did not fail as expected');
        } catch (ex) {
            const err = WrappedError.unwrap(ex) as BaseKernelError;
            // Depending on whether its jupter or raw kernels, we could get a different error thrown.
            assert.include('noipykernel kerneldied', err.category);
        }

        console.log('Step6');
        assert.strictEqual(promptToInstall.getDisplayCount(), 0, 'Prompt should not have been displayed');
        promptToInstall.dispose();

        assert.strictEqual(
            window.activeNotebookEditor?.document.cellAt(0).outputs.length,
            0,
            'Should not have any outputs with ipykernel missing error'
        );

        // If we try to run a cell, verify a prompt is displayed.
        console.log('Step7');
        await openNotebookAndInstallIpyKernelWhenRunningCell(venvPythonPath);
    });
    async function uninstallIPyKernel(pythonExecPath: string) {
        // Uninstall ipykernel from the virtual env.
        const proc = new ProcessService(new BufferDecoder());
        await proc.exec(pythonExecPath, ['-m', 'pip', 'uninstall', 'ipykernel', '--yes']);
    }
    async function installIPyKernel(pythonExecPath: string) {
        // Uninstall ipykernel from the virtual env.
        const proc = new ProcessService(new BufferDecoder());
        await proc.exec(pythonExecPath, ['-m', 'pip', 'install', 'ipykernel']);
    }
    async function selectKernelFromIPyKernelPrompt() {
        return hijackPrompt(
            'showInformationMessage',
            { contains: expectedPromptMessageSuffix },
            { text: DataScience.selectKernel(), clickImmediately: true },
            disposables
        );
    }
    async function clickInstallFromIPyKernelPrompt() {
        return hijackPrompt(
            'showInformationMessage',
            { contains: expectedPromptMessageSuffix },
            { text: Common.install(), clickImmediately: true },
            disposables
        );
    }
    /**
     * Performs a few assertions in this function:
     *
     * 1. Verify IPYKernel installation prompt is displayed.
     * 2. Verify IPYKernel is installed (based on value for the argument for `ipykernelInstallRequirement`)
     * 3. Verify the Kernel points to the right interpreter
     */
    async function openNotebookAndInstallIpyKernelWhenRunningCell(
        interpreterPath: string,
        interpreterOfNewKernelToSelect?: string,
        ipykernelInstallRequirement: 'DoNotInstallIPyKernel' | 'ShouldInstallIPYKernel' = 'ShouldInstallIPYKernel'
    ) {
        // Highjack the IPyKernel not installed prompt and click the appropriate button.
        let promptToInstall = await (interpreterOfNewKernelToSelect
            ? selectKernelFromIPyKernelPrompt()
            : clickInstallFromIPyKernelPrompt());

        installerSpy = sinon.spy(installer, 'install');

        let selectADifferentKernelStub: undefined | sinon.SinonStub<any[], any>;
        try {
            console.log('Stepa');
            if (!workspace.notebookDocuments.some((item) => item.uri.fsPath.toLowerCase() === nbFile.toLowerCase())) {
                await openNotebook(nbFile);
                await waitForKernelToChange({ interpreterPath });
            }
            console.log('Stepb');

            if (interpreterOfNewKernelToSelect) {
                // If we have a separate interpreter specified then configure the prompts such that
                // this will be selected as the new kernel when we display the ipykernel not installed prompt.
                const result = hookupKernelSelected(
                    promptToInstall,
                    interpreterOfNewKernelToSelect,
                    ipykernelInstallRequirement
                );
                selectADifferentKernelStub = result.selectADifferentKernelStub;
            }
            const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

            console.log('Stepc');
            await Promise.all([
                runAllCellsInActiveNotebook(),
                waitForCondition(
                    async () => promptToInstall.displayed.then(() => true),
                    delayForUITest,
                    'Prompt not displayed'
                ),
                ipykernelInstallRequirement === 'DoNotInstallIPyKernel'
                    ? Promise.resolve()
                    : waitForIPyKernelToGetInstalled(),
                waitForExecutionCompletedSuccessfully(cell),
                waitForCellHavingOutput(cell)
            ]);

            console.log('Stepd');
            // Verify the kernel points to the expected interpreter.
            const output = getCellOutputs(cell).trim();
            const expectedInterpreterPath = interpreterOfNewKernelToSelect || interpreterPath;
            assert.isTrue(
                areInterpreterPathsSame(expectedInterpreterPath.toLowerCase(), output.toLocaleLowerCase()),
                `Kernel points to ${getDisplayPath(output)} but expected ${getDisplayPath(expectedInterpreterPath)}`
            );

            // Verify ipykernel was not installed if not required && vice versa.
            console.log('Stepe');
            if (ipykernelInstallRequirement === 'DoNotInstallIPyKernel') {
                if (installerSpy.callCount > 0) {
                    IInstaller;
                    assert.fail(
                        `IPyKernel was installed when it should not have been, here are the calls: ${installerSpy
                            .getCalls()
                            .map((call) => {
                                const args: Parameters<IInstaller['install']> = call.args as any;
                                return `${ProductNames.get(args[0])} ${getDisplayPath(args[1]?.path.toString())}`;
                            })
                            .join('\n')}`
                    );
                }
            }
        } finally {
            promptToInstall.dispose();
            selectADifferentKernelStub?.restore();
            installerSpy.restore();
        }
    }
    function waitForIPyKernelToGetInstalled() {
        return waitForCondition(
            async () => verifyIPyKernelWasInstalled(),
            delayForUITest,
            () =>
                `Prompt not displayed or not installed successfully, call count = ${installerSpy.callCount}, arg0 ${
                    installerSpy.callCount ? installerSpy.getCall(0).args[0] : undefined
                }, result ${installerSpy.callCount ? installerSpy.getCall(0).returnValue : undefined}`
        );
    }
    async function verifyIPyKernelWasInstalled() {
        assert.strictEqual(installerSpy.callCount, 1);
        assert.strictEqual(installerSpy.getCall(0).args[0], Product.ipykernel);
        assert.strictEqual(await installerSpy.getCall(0).returnValue, InstallerResponse.Installed);
        return true;
    }

    function verifyInstallIPyKernelInstructionsInOutput(cell: NotebookCell) {
        const textToLookFor = `Run the following command to install '${ProductNames.get(Product.ipykernel)!}'`;
        const err = translateCellErrorOutput(cell.outputs[0]);
        assert.include(err.traceback.join(''), textToLookFor);
        return true;
    }
    type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
    function hookupKernelSelected(
        promptToInstall: Awaited<ReturnType<typeof selectKernelFromIPyKernelPrompt>>,
        pythonPathToNewKernel: string,
        ipykernelInstallRequirement: 'DoNotInstallIPyKernel' | 'ShouldInstallIPYKernel' = 'ShouldInstallIPYKernel'
    ) {
        // Get the controller that should be selected.
        const controllerManager = api.serviceContainer.get<INotebookControllerManager>(INotebookControllerManager);
        const controller = controllerManager
            .registeredNotebookControllers()
            .find(
                (item) =>
                    item.controller.notebookType === JupyterNotebookView &&
                    item.connection.kind === 'startUsingPythonInterpreter' &&
                    areInterpreterPathsSame(item.connection.interpreter.path, pythonPathToNewKernel)
            );
        if (!controller) {
            const registeredControllers = controllerManager
                .registeredNotebookControllers()
                .map((item) => item.id)
                .join(',');
            throw new Error(
                `Unable to find a controller for ${pythonPathToNewKernel}, registered controllers ids are ${registeredControllers}`
            );
        }

        const kernelSelected = createDeferred<boolean>();
        const selectADifferentKernelStub = sinon
            .stub(commandManager, 'executeCommand')
            .callsFake(async function (cmd: string) {
                if (cmd === 'notebook.selectKernel') {
                    // After we change the kernel, we might get a prompt to install ipykernel.
                    // Ensure we click ok to install.
                    if (promptToInstall.getDisplayCount() > 0) {
                        promptToInstall.dispose();
                        if (ipykernelInstallRequirement === 'ShouldInstallIPYKernel') {
                            await clickInstallFromIPyKernelPrompt();
                        }
                    }
                    await commands.executeCommand('notebook.selectKernel', {
                        id: controller.controller.id,
                        extension: JVSC_EXTENSION_ID_FOR_TESTS
                    });

                    kernelSelected.resolve(true);
                    return Promise.resolve(true);
                } else {
                    return commands.executeCommand.apply(commands, [cmd, ...Array.from(arguments).slice(1)]);
                }
            });

        return { kernelSelected: kernelSelected.promise, selectADifferentKernelStub };
    }
});
