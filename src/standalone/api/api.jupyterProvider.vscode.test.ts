// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IExtensions } from '../../platform/common/types';
import { traceInfo } from '../../platform/logging';
import { IExtensionTestApi, waitForCondition } from '../../test/common';
import { noop } from '../../test/core';
import { initialize } from '../../test/initialize';
import { closeNotebooksAndCleanUpAfterTests, createTemporaryNotebook } from '../../test/datascience/notebook/helper';
import {
    CancellationToken,
    CancellationTokenSource,
    Command,
    EventEmitter,
    NotebookKernelSourceActionProvider,
    QuickPickItem,
    QuickPickItemKind,
    Uri,
    commands,
    notebooks,
    window
} from 'vscode';
import { JupyterServer } from '../../api';
import { openAndShowNotebook } from '../../platform/common/utils/notebooks';
import { JupyterServer as JupyterServerStarter } from '../../test/datascience/jupyterServer.node';
import { IS_REMOTE_NATIVE_TEST } from '../../test/constants';
import { isWeb } from '../../platform/common/utils/misc';
import { BaseProviderBasedQuickPick } from '../../platform/common/providerBasedQuickPick';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import {
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata,
    isRemoteConnection
} from '../../kernels/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';

suite('Jupyter Provider Tests', function () {
    // On conda these take longer for some reason.
    this.timeout(1200_000);
    let api: IExtensionTestApi;
    let jupyterServerUrl = { url: '', dispose: noop };
    const disposables: IDisposable[] = [];
    let nbProviders: { provider: NotebookKernelSourceActionProvider; disposable: IDisposable }[] = [];
    let token: CancellationToken;
    let controllers: IControllerRegistration;
    const tokenForJupyterServer = 'TokenForJupyterServer';
    suiteSetup(async function () {
        if (IS_REMOTE_NATIVE_TEST() || isWeb()) {
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        const tokenSource = new CancellationTokenSource();
        disposables.push(tokenSource);
        token = tokenSource.token;
        controllers = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        jupyterServerUrl = await JupyterServerStarter.instance.startJupyter({
            jupyterLab: true,
            token: tokenForJupyterServer
        });
    });
    suiteTeardown(() => {
        disposeAllDisposables(disposables.concat(jupyterServerUrl));
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon
            .stub(api.serviceContainer.get<IExtensions>(IExtensions), 'determineExtensionFromCallStack')
            .resolves({ extensionId: 'GitHub', displayName: 'Sample Extension' });
        const registerKernelSourceActionProviderStub = sinon
            .stub(notebooks, 'registerKernelSourceActionProvider')
            .callsFake((notebookType, provider) => {
                const disposable = registerKernelSourceActionProviderStub.wrappedMethod(notebookType, provider);
                nbProviders.push({ provider, disposable });
                return disposable;
            });
        traceInfo(`Start Test Completed ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        sinon.restore();
        disposeAllDisposables(disposables);
        traceInfo(`End Test Completed ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Verify Kernel Source Action is registered & unregistered for the 3rd party extension', async () => {
        const collection1 = api.createJupyterServerCollection('sample1', 'First Collection');
        const collection2 = api.createJupyterServerCollection('sample2', 'Second Collection');
        collection1.serverProvider = {
            provideJupyterServers: () => Promise.resolve([]),
            resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
        };
        collection2.serverProvider = {
            provideJupyterServers: () => Promise.resolve([]),
            resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
        };
        disposables.push(collection1);
        disposables.push(collection2);
        let matchingDisposable1: IDisposable | undefined;
        let matchingDisposable2: IDisposable | undefined;
        await waitForCondition(
            async () => {
                for (const { provider, disposable } of nbProviders) {
                    // We could have other providers being registered in the test env, such as github code spaces, azml, etc
                    const actions = await provider.provideNotebookKernelSourceActions(token);
                    assert.strictEqual(actions?.length, 1);
                    if (actions![0].label === 'First Collection') {
                        matchingDisposable1 = disposable;
                    }
                    if (actions![0].label === 'Second Collection') {
                        matchingDisposable2 = disposable;
                    }
                    if (matchingDisposable1 && matchingDisposable2) {
                        return true;
                    }
                }
                return false;
            },
            120_000,
            'Providers not registered for IW and Notebook'
        );
        if (!matchingDisposable1 || !matchingDisposable2) {
            throw new Error('Provider not registered');
        }
        // Once we dispose the collection, this item should no longer be in the list of the actions.
        const disposeStub1 = sinon.stub(matchingDisposable1, 'dispose');
        const disposeStub2 = sinon.stub(matchingDisposable2, 'dispose');
        collection1.dispose();

        await waitForCondition(() => disposeStub1.called, 10_000, 'Kernel Source Action not removed');
        assert.strictEqual(disposeStub2.called, false, 'Second collection should not be disposed');

        collection2.dispose();
        await waitForCondition(
            () => disposeStub2.called,
            10_000,
            'Kernel Source Action not removed for second collection'
        );
    });
    test('Verify 3rd party extension Jupyter Server is auto selected when there is only one server', async () => {
        const collection = api.createJupyterServerCollection(
            'sampleServerProvider1',
            'First Collection For Second Test'
        );
        collection.serverProvider = {
            provideJupyterServers: () => Promise.resolve([]),
            resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
        };
        const server: JupyterServer = {
            id: 'Server1ForTesting',
            label: 'Server 1',
            connectionInformation: {
                baseUrl: Uri.parse(new URL(jupyterServerUrl.url).origin),
                token: tokenForJupyterServer
            }
        };
        collection.serverProvider = {
            provideJupyterServers: () => Promise.resolve([server]),
            resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
        };
        disposables.push(collection);
        let matchingProvider: NotebookKernelSourceActionProvider | undefined;
        await waitForCondition(
            async () => {
                for (const { provider } of nbProviders) {
                    // We could have other providers being registered in the test env, such as github code spaces, azml, etc
                    const actions = await provider.provideNotebookKernelSourceActions(token);
                    assert.strictEqual(actions?.length, 1);
                    if (actions![0].label === 'First Collection For Second Test') {
                        matchingProvider = provider;
                        return true;
                    }
                }
                return false;
            },
            120_000,
            'Providers not registered for IW and Notebook'
        );
        if (!matchingProvider) {
            throw new Error('Provider not registered');
        }

        // Ensure we have a notebook document opened for testing.
        const nbFile = await createTemporaryNotebook([], disposables);
        // Open a python notebook and use this for all tests in this test suite.
        await openAndShowNotebook(nbFile);

        // When the source is selected, we should display a list of kernels,
        let selectedItem: RemoteKernelSpecConnectionMetadata;
        const selectItemStub = sinon.stub(BaseProviderBasedQuickPick.prototype, 'selectItem').callsFake(function (
            this: any,
            token
        ) {
            // Quick Pick will be created
            const quickPickStub = sinon.stub(window, 'createQuickPick').callsFake(() => {
                const quickPick = quickPickStub.wrappedMethod();
                const onDidChangeSelection = new EventEmitter<QuickPickItem[]>();
                const show = sinon.stub(quickPick, 'show').callsFake(function (this: any) {
                    const checkAndSelect = () => {
                        // Select a Python kernelspec from the 3rd party jupyter server.
                        const pythonKernelSpecItem = quickPick.items
                            .filter((item) => item.kind !== QuickPickItemKind.Separator)
                            .find(
                                (e) =>
                                    'item' in e &&
                                    (e.item as RemoteKernelSpecConnectionMetadata).kind ===
                                        'startUsingRemoteKernelSpec' &&
                                    (e.item as RemoteKernelSpecConnectionMetadata).kernelSpec.language ===
                                        PYTHON_LANGUAGE
                            );
                        if (pythonKernelSpecItem) {
                            selectedItem = (pythonKernelSpecItem as any).item;
                            onDidChangeSelection.fire([pythonKernelSpecItem]);
                        } else {
                            // Try every 100ms
                            setTimeout(checkAndSelect, 100);
                        }
                    };
                    checkAndSelect();
                    show.wrappedMethod.bind(this)();
                });
                (quickPick as any).onDidChangeSelection = onDidChangeSelection.event;
                return quickPick;
            });
            const selection = selectItemStub.wrappedMethod.bind(this)(token);
            selection.finally(() => quickPickStub.restore()).catch(noop);
            return selection;
        });
        const actions = await matchingProvider.provideNotebookKernelSourceActions(token);
        const actionCommand: Command = actions![0].command as unknown as Command;
        const controllerId = await commands.executeCommand(actionCommand.command, ...(actionCommand.arguments || []));

        // Verify a controller is selected
        assert.isOk(controllerId);

        // Verify this controller belongs to the 3rd party server.
        const controller = controllers.registered.find((c) => c.id === controllerId);
        assert.isOk(controller);
        const remoteConnection = controller!.connection as RemoteKernelConnectionMetadata;
        assert.isTrue(isRemoteConnection(remoteConnection));
        assert.strictEqual(remoteConnection.serverProviderHandle.extensionId, 'GitHub');
        assert.strictEqual(remoteConnection.serverProviderHandle.id, 'sampleServerProvider1');
        assert.strictEqual(remoteConnection.serverProviderHandle.handle, 'Server1ForTesting');
        assert.strictEqual(remoteConnection.id, selectedItem!.id);
    });
});
