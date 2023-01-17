// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'vscode';
import { IApplicationShell, IVSCodeNotebook } from '../../../platform/common/application/types';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { sleep } from '../../core';
import { DataScience } from '../../../platform/common/utils/localize';
import { IExtensionTestApi, initialize, startJupyterServer } from '../../common';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    hijackPrompt,
    insertCodeCell,
    runCell,
    waitForTextOutput,
    WindowPromptStub
} from '../../datascience/notebook/helper';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { PythonExtensionRestartNotification } from '../../../standalone/notification/pythonExtensionRestartNotification';
import { IKernelProvider } from '../../../kernels/types';
import { noop } from '../../../platform/common/utils/misc';

suite('Python Extension Restart Notification @kernelPicker', () => {
    let api: IExtensionTestApi;
    let extensionChecker: IPythonExtensionChecker;
    let vscodeNotebook: IVSCodeNotebook;
    let hijackedMessage: WindowPromptStub;
    let fakeInstalledEventEmitter: EventEmitter<'installed' | 'uninstalled'>;
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        await closeNotebooksAndCleanUpAfterTests();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    });
    setup(async function () {
        api = await initialize();
        extensionChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        sinon.restore();

        // Stub out a fake event emitter for the extension checker to simulate install
        fakeInstalledEventEmitter = new EventEmitter<'installed' | 'uninstalled'>();
        sinon.stub(extensionChecker, 'onPythonExtensionInstallationStatusChanged').get(() => {
            return fakeInstalledEventEmitter.event;
        });

        // Hijack the info message prompt
        hijackedMessage = await hijackPrompt('showInformationMessage', {
            contains: DataScience.pythonExtensionInstalled
        });

        // Create an instance of the restart notification with the stubbed checker
        const notifier = createService(api.serviceContainer);
        notifier.activate();
    });
    teardown(async function () {
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    test('When installing Python Extension with no kernels active, do not warn', async () => {
        // Fire the installed event, wait a bit, then verify that our prompt was not shown
        fakeInstalledEventEmitter.fire('installed');
        await sleep(500);
        assert(hijackedMessage.getDisplayCount() === 0);
    });
    test('When installing Python Extension with a kernel active, warn', async () => {
        // Open up a notebook and execute one cell to get the kernel active
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables);
        const vscEditor = vscodeNotebook.activeNotebookEditor!;
        await insertCodeCell('print("1")', { index: 0 });
        const cell = vscEditor.notebook.cellAt(0);
        runCell(cell).catch(noop);
        await waitForTextOutput(cell, '1', 0, false, 120_000);

        // Fire the installed event, wait a bit, then verify that our prompt was shown once
        fakeInstalledEventEmitter.fire('installed');
        await hijackedMessage.displayed;
        assert(hijackedMessage.getDisplayCount() === 1);
    });
    function createService(serviceContainer: IServiceContainer): PythonExtensionRestartNotification {
        return new PythonExtensionRestartNotification(
            serviceContainer.get(IPythonExtensionChecker),
            serviceContainer.get(IDisposableRegistry),
            serviceContainer.get(IApplicationShell),
            serviceContainer.get(IKernelProvider)
        );
    }
});
