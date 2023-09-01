// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import { dispose } from '../../platform/common/helpers';
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
    QuickPick,
    QuickPickItem,
    QuickPickItemKind,
    Uri,
    commands,
    notebooks
} from 'vscode';
import { JupyterServer } from '../../api';
import { openAndShowNotebook } from '../../platform/common/utils/notebooks';
import { JupyterServer as JupyterServerStarter } from '../../test/datascience/jupyterServer.node';
import { IS_REMOTE_NATIVE_TEST } from '../../test/constants';
import { isWeb } from '../../platform/common/utils/misc';
import { MultiStepInput } from '../../platform/common/utils/multiStepInput';

suite('Jupyter Provider Tests', function () {
    // On conda these take longer for some reason.
    this.timeout(120_000);
    let api: IExtensionTestApi;
    let jupyterServerUrl = { url: '', dispose: noop };
    const disposables: IDisposable[] = [];
    let nbProviders: { provider: NotebookKernelSourceActionProvider; disposable: IDisposable }[] = [];
    let token: CancellationToken;
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
        jupyterServerUrl = await JupyterServerStarter.instance.startJupyter({
            token: tokenForJupyterServer
        });
    });
    suiteTeardown(() => {
        dispose(disposables.concat(jupyterServerUrl));
        return closeNotebooksAndCleanUpAfterTests(disposables);
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
        dispose(disposables);
        traceInfo(`End Test Completed ${this.currentTest?.title}`);
    });
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
    // Flaky test, leaving as I'd like to try to get this working in debt week.
    // test('Verify 3rd party extension Jupyter Server is auto selected when there is only one server', async () => {
    //     const collection = api.createJupyterServerCollection(
    //         `sampleServerProvider1${Date.now()}`,
    //         'First Collection For Second Test'
    //     );
    //     collection.serverProvider = {
    //         provideJupyterServers: () => Promise.resolve([]),
    //         resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
    //     };
    //     const server: JupyterServer = {
    //         id: 'Server1ForTesting',
    //         label: 'Server 1',
    //         connectionInformation: {
    //             baseUrl: Uri.parse(new URL(jupyterServerUrl.url).origin),
    //             token: tokenForJupyterServer
    //         }
    //     };
    //     collection.serverProvider = {
    //         provideJupyterServers: () => Promise.resolve([server]),
    //         resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
    //     };
    //     disposables.push(collection);
    //     let matchingProvider: NotebookKernelSourceActionProvider | undefined;
    //     await waitForCondition(
    //         async () => {
    //             for (const { provider } of nbProviders) {
    //                 // We could have other providers being registered in the test env, such as github code spaces, azml, etc
    //                 const actions = await provider.provideNotebookKernelSourceActions(token);
    //                 assert.strictEqual(actions?.length, 1);
    //                 if (actions![0].label === 'First Collection For Second Test') {
    //                     matchingProvider = provider;
    //                     return true;
    //                 }
    //             }
    //             return false;
    //         },
    //         120_000,
    //         'Providers not registered for IW and Notebook'
    //     );
    //     if (!matchingProvider) {
    //         throw new Error('Provider not registered');
    //     }

    //     // Ensure we have a notebook document opened for testing.
    //     const nbFile = await createTemporaryNotebook([], disposables);
    //     // Open a python notebook and use this for all tests in this test suite.
    //     await openAndShowNotebook(nbFile);

    //     // When the source is selected, we should display a list of kernels,
    //     let selectedItem: RemoteKernelSpecConnectionMetadata;
    //     const selectItemStub = sinon.stub(BaseProviderBasedQuickPick.prototype, 'selectItem').callsFake(function (
    //         this: any,
    //         token
    //     ) {
    //         // Quick Pick will be created
    //         const quickPickStub = sinon.stub(window, 'createQuickPick').callsFake(() => {
    //             const quickPick = quickPickStub.wrappedMethod();
    //             const onDidChangeSelection = new EventEmitter<QuickPickItem[]>();
    //             const show = sinon.stub(quickPick, 'show').callsFake(function (this: any) {
    //                 const checkAndSelect = () => {
    //                     // Select a Python kernelspec from the 3rd party jupyter server.
    //                     const pythonKernelSpecItem = quickPick.items
    //                         .filter((item) => item.kind !== QuickPickItemKind.Separator)
    //                         .find(
    //                             (e) =>
    //                                 'item' in e &&
    //                                 (e.item as RemoteKernelSpecConnectionMetadata).kind ===
    //                                     'startUsingRemoteKernelSpec' &&
    //                                 (e.item as RemoteKernelSpecConnectionMetadata).kernelSpec.language ===
    //                                     PYTHON_LANGUAGE
    //                         );
    //                     if (pythonKernelSpecItem) {
    //                         selectedItem = (pythonKernelSpecItem as any).item;
    //                         onDidChangeSelection.fire([pythonKernelSpecItem]);
    //                     } else {
    //                         // Try every 100ms
    //                         setTimeout(checkAndSelect, 100);
    //                     }
    //                 };
    //                 checkAndSelect();
    //                 show.wrappedMethod.bind(this)();
    //             });
    //             (quickPick as any).onDidChangeSelection = onDidChangeSelection.event;
    //             return quickPick;
    //         });
    //         const selection = selectItemStub.wrappedMethod.bind(this)(token);
    //         selection.finally(() => quickPickStub.restore()).catch(noop);
    //         return selection;
    //     });
    //     const actions = await matchingProvider.provideNotebookKernelSourceActions(token);
    //     const actionCommand: Command = actions![0].command as unknown as Command;
    //     const controllerId = await commands.executeCommand(actionCommand.command, ...(actionCommand.arguments || []));

    //     // Verify a controller is selected
    //     assert.isOk(controllerId);

    //     // Verify this controller belongs to the 3rd party server.
    //     const controller = controllers.registered.find((c) => c.id === controllerId);
    //     assert.isOk(controller);
    //     const remoteConnection = controller!.connection as RemoteKernelConnectionMetadata;
    //     assert.isTrue(isRemoteConnection(remoteConnection));
    //     assert.strictEqual(remoteConnection.serverProviderHandle.extensionId, 'GitHub');
    //     assert.isOk(remoteConnection.serverProviderHandle.id.startsWith('sampleServerProvider1'));
    //     assert.strictEqual(remoteConnection.serverProviderHandle.handle, 'Server1ForTesting');
    //     assert.strictEqual(remoteConnection.id, selectedItem!.id);
    // });
    test('When there are 2 or more servers, then user is prompted to select a server', async () => {
        const collection = api.createJupyterServerCollection(
            'sampleServerProvider2',
            'First Collection For Third Test'
        );
        disposables.push(collection);
        collection.serverProvider = {
            provideJupyterServers: () => Promise.resolve([]),
            resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
        };
        const server1: JupyterServer = {
            id: 'Server1ForTesting',
            label: 'Server 1',
            connectionInformation: {
                baseUrl: Uri.parse(new URL(jupyterServerUrl.url).origin),
                token: tokenForJupyterServer
            }
        };
        const server2: JupyterServer = {
            id: 'Server2ForTesting',
            label: 'Server 2',
            connectionInformation: {
                baseUrl: Uri.parse(new URL(jupyterServerUrl.url).origin),
                token: tokenForJupyterServer
            }
        };
        const server3: JupyterServer = {
            id: 'Server3ForTesting',
            label: 'Server 3',
            connectionInformation: {
                baseUrl: Uri.parse(new URL(jupyterServerUrl.url).origin),
                token: tokenForJupyterServer
            }
        };
        const servers = [server1, server2, server3];
        const onDidChangeServers = new EventEmitter<void>();
        disposables.push(onDidChangeServers);
        collection.serverProvider = {
            onDidChangeServers: onDidChangeServers.event,
            provideJupyterServers: () => Promise.resolve(servers),
            resolveJupyterServer: () => Promise.reject(new Error('Not Implemented'))
        };

        let matchingProvider: NotebookKernelSourceActionProvider | undefined;
        await waitForCondition(
            async () => {
                for (const { provider } of nbProviders) {
                    // We could have other providers being registered in the test env, such as github code spaces, azml, etc
                    const actions = await provider.provideNotebookKernelSourceActions(token);
                    assert.strictEqual(actions?.length, 1);
                    if (actions![0].label === 'First Collection For Third Test') {
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
        const multiStepStub = sinon.stub(MultiStepInput.prototype, 'showLazyLoadQuickPick').callsFake(function (
            this: any,
            options
        ) {
            const result: { quickPick: QuickPick<QuickPickItem>; selection: Promise<unknown> } =
                multiStepStub.wrappedMethod.bind(this)(options);
            result.quickPick.hide();
            const selection = Promise.resolve(undefined); // Do not select anything.
            return { quickPick: result.quickPick, selection } as any;
        });
        const actions = await matchingProvider.provideNotebookKernelSourceActions(token);
        const actionCommand: Command = actions![0].command as unknown as Command;
        const controllerId = await commands.executeCommand(actionCommand.command, ...(actionCommand.arguments || []));

        // Verify a controller is not selected
        assert.isUndefined(controllerId);
        // Verify quick pick was displayed with three items.
        assert.strictEqual(multiStepStub.callCount, 1);
        assert.strictEqual(multiStepStub.args[0][0].items.length, 3);
        assert.deepEqual(
            multiStepStub.args[0][0].items.map((e) => e.label).sort(),
            ['Server 1', 'Server 2', 'Server 3'],
            'Jupyter Servers not displayed in quick picks'
        );

        // Ok, now remove one server and verify the quick pick now displays 2 items.
        servers.splice(1, 1);
        onDidChangeServers.fire();
        const controllerId2 = await commands.executeCommand(actionCommand.command, ...(actionCommand.arguments || []));
        // Verify a controller is not selected
        assert.isUndefined(controllerId2);
        assert.strictEqual(multiStepStub.callCount, 2);
        assert.strictEqual(multiStepStub.args[1][0].items.length, 2);
        assert.deepEqual(
            multiStepStub.args[1][0].items.map((e) => e.label).sort(),
            ['Server 1', 'Server 3'],
            'Jupyter Servers not displayed in quick picks'
        );

        // Add a command and that command should be displayed along with the 2 servers.
        let commandsToReturn = [{ label: 'Sample Command' }];
        collection.commandProvider = {
            provideCommands: () => Promise.resolve(commandsToReturn),
            handleCommand: () => Promise.resolve(undefined)
        };
        // await sleep(100);

        const controllerId3 = await commands.executeCommand(actionCommand.command, ...(actionCommand.arguments || []));
        // Verify a controller is not selected
        assert.isUndefined(controllerId3);
        assert.strictEqual(multiStepStub.callCount, 3);
        assert.strictEqual(multiStepStub.args[2][0].items.length, 4); // One separator and one item
        assert.deepEqual(
            multiStepStub.args[2][0].items
                .filter((e) => e.kind !== QuickPickItemKind.Separator)
                .map((e) => e.label)
                .sort(),
            ['Server 1', 'Server 3', 'Sample Command'].sort(),
            'Jupyter Servers not displayed in quick picks'
        );

        // Remove the command and try again.
        commandsToReturn = [];

        const controllerId4 = await commands.executeCommand(actionCommand.command, ...(actionCommand.arguments || []));
        // Verify a controller is not selected
        assert.isUndefined(controllerId4);
        assert.strictEqual(multiStepStub.callCount, 4);
        assert.strictEqual(multiStepStub.args[3][0].items.length, 2);
        assert.deepEqual(
            multiStepStub.args[3][0].items
                .filter((e) => e.kind !== QuickPickItemKind.Separator)
                .map((e) => e.label)
                .sort(),
            ['Server 1', 'Server 3'].sort(),
            'Jupyter Servers not displayed in quick picks'
        );
    });
});
