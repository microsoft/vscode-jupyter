// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import {
    CancellationTokenSource,
    Disposable,
    EventEmitter,
    NotebookDocument,
    QuickInputButton,
    QuickPick,
    QuickPickItem,
    Uri
} from 'vscode';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import {
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, ReadWrite } from '../../../platform/common/types';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IQuickPickParameters,
    MultiStepInputQuickPicResponseType
} from '../../../platform/common/utils/multiStepInput';
import { ServiceContainer } from '../../../platform/ioc/container';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { noop } from '../../../test/core';
import {
    IConnectionDisplayData,
    ConnectionDisplayDataProvider,
    getKernelConnectionCategorySync
} from '../connectionDisplayData';
import { CreateAndSelectItemFromQuickPick, isKernelPickItem, KernelSelector } from './kernelSelector';
import { ConnectionQuickPickItem, IQuickPickKernelItemProvider } from './types';

suite('Kernel Selector', () => {
    let kernelSelector: KernelSelector;
    let clock: fakeTimers.InstalledClock;
    let onDidChangeProvider: EventEmitter<void>;
    let onDidChangeProviderStatus: EventEmitter<void>;
    let onDidChangeRecommended: EventEmitter<void>;
    let onDidFailToListKernels: EventEmitter<Error>;
    const disposables: IDisposable[] = [];
    let cancellation: CancellationTokenSource;
    let notebook: NotebookDocument;
    let workspaceService: IWorkspaceService;
    let displayDataProvider: ConnectionDisplayDataProvider;
    let pythonChecker: IPythonExtensionChecker;
    let provider: ReadWrite<IQuickPickKernelItemProvider>;
    let kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>;
    let quickPickFactory: CreateAndSelectItemFromQuickPick;
    let quickPickCreated: boolean | undefined;
    let selectionPromise: Deferred<
        MultiStepInputQuickPicResponseType<
            QuickPickItem | ConnectionQuickPickItem,
            IQuickPickParameters<QuickPickItem | ConnectionQuickPickItem>
        >
    >;
    let onDidTriggerQuickPickButton: EventEmitter<QuickInputButton>;
    let quickPick: QuickPick<QuickPickItem | ConnectionQuickPickItem>;
    let options: Parameters<CreateAndSelectItemFromQuickPick>[0];

    let localPythonKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'localPythonKernelSpec',
        kernelSpec: {
            argv: [],
            display_name: 'Local Python Kernel Spec',
            executable: '',
            name: 'localPythonKernelSpec',
            language: 'python'
        }
    });
    let localJavaKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'localJavaKernelSpec',
        kernelSpec: {
            argv: [],
            display_name: 'Local Java Kernel Spec',
            executable: '',
            name: 'localJavaKernelSpec',
            language: 'java'
        }
    });
    let localJuliaKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'localJuliaKernelSpec',
        kernelSpec: {
            argv: [],
            display_name: 'Local Julia Kernel Spec',
            executable: '',
            name: 'localJuliaKernelSpec',
            language: 'julia'
        }
    });
    let venvPythonKernel = PythonKernelConnectionMetadata.create({
        id: 'venvPythonEnv',
        interpreter: {
            id: 'venvPython',
            sysPrefix: '',
            uri: Uri.file('venv'),
            displayName: 'Venv',
            envType: EnvironmentType.Venv,
            version: { major: 3, minor: 8, patch: 0, raw: '3.8.0' }
        },
        kernelSpec: {
            argv: [],
            display_name: 'Local Python Venv Spec',
            executable: '',
            name: 'localPythonKernelVenvSpec',
            language: 'python'
        }
    });
    let condaKernel = PythonKernelConnectionMetadata.create({
        id: 'condaEnv',
        interpreter: {
            id: 'condaPython',
            sysPrefix: '',
            uri: Uri.file('conda'),
            displayName: 'Conda',
            envType: EnvironmentType.Conda
        },
        kernelSpec: {
            argv: [],
            display_name: 'Local Python Conda Spec',
            executable: '',
            name: 'localPythonKernelCondaSpec',
            language: 'python'
        }
    });
    let sysPythonKernel = PythonKernelConnectionMetadata.create({
        id: 'sysPythonEnv',
        interpreter: {
            id: 'sysPython',
            sysPrefix: '',
            uri: Uri.file('sys'),
            displayName: 'Global',
            envType: EnvironmentType.Unknown,
            version: { major: 3, minor: 11, patch: 0, raw: '3.11.0' }
        },
        kernelSpec: {
            argv: [],
            display_name: 'Global Python Spec',
            executable: '',
            name: 'localPythonKernelGlobalSpec',
            language: 'python'
        }
    });
    setup(() => {
        selectionPromise =
            createDeferred<
                MultiStepInputQuickPicResponseType<
                    QuickPickItem | ConnectionQuickPickItem,
                    IQuickPickParameters<QuickPickItem | ConnectionQuickPickItem>
                >
            >();
        const serviceContainer = mock<ServiceContainer>();
        const iocStub = sinon.stub(ServiceContainer, 'instance').get(() => instance(serviceContainer));
        disposables.push(new Disposable(() => iocStub.restore()));
        cancellation = new CancellationTokenSource();
        disposables.push(cancellation);

        notebook = mock<NotebookDocument>();
        pythonChecker = mock<IPythonExtensionChecker>();
        kernelFinder = mock<IContributedKernelFinder<KernelConnectionMetadata>>();
        displayDataProvider = mock<ConnectionDisplayDataProvider>();
        workspaceService = mock<IWorkspaceService>();
        onDidChangeProvider = new EventEmitter<void>();
        onDidChangeProviderStatus = new EventEmitter<void>();
        onDidChangeRecommended = new EventEmitter<void>();
        onDidTriggerQuickPickButton = new EventEmitter<QuickInputButton>();
        onDidFailToListKernels = new EventEmitter<Error>();
        disposables.push(onDidChangeProvider);
        disposables.push(onDidChangeProviderStatus);
        disposables.push(onDidChangeRecommended);
        disposables.push(onDidTriggerQuickPickButton);
        disposables.push(onDidFailToListKernels);

        quickPick = {
            title: '',
            activeItems: [],
            busy: false,
            buttons: [],
            canSelectMany: false,
            dispose: noop,
            enabled: true,
            hide: noop,
            ignoreFocusOut: false,
            items: [],
            matchOnDescription: true,
            matchOnDetail: true,
            onDidTriggerButton: onDidTriggerQuickPickButton.event,
            placeholder: '',
            selectedItems: [],
            show: noop,
            sortByLabel: true,
            step: undefined,
            value: '',
            totalSteps: undefined
        } as any;

        provider = {
            onDidFailToListKernels: onDidFailToListKernels.event,
            title: '',
            kind: ContributedKernelFinderKind.LocalKernelSpec,
            onDidChange: onDidChangeProvider.event,
            kernels: [],
            onDidChangeStatus: onDidChangeProviderStatus.event,
            onDidChangeRecommended: onDidChangeRecommended.event,
            status: 'idle',
            refresh: async () => noop(),
            recommended: undefined
        };
        when(workspaceService.isTrusted).thenReturn(true);
        when(serviceContainer.get<ConnectionDisplayDataProvider>(ConnectionDisplayDataProvider)).thenReturn(
            instance(displayDataProvider)
        );
        when(serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker)).thenReturn(
            instance(pythonChecker)
        );
        when(displayDataProvider.getDisplayData(anything())).thenCall((c: KernelConnectionMetadata) => {
            return <IConnectionDisplayData>{
                category: getKernelConnectionCategorySync(c),
                label: getDisplayNameOrNameOfKernelConnection(c),
                connectionId: c.id,
                description: c.id,
                detail: c.id
            };
        });
        when(pythonChecker.isPythonExtensionInstalled).thenReturn(true);
        quickPickFactory = (opts) => {
            quickPickCreated = true;
            options = opts;
            quickPick.items = options.items;
            quickPick.title = options.title;
            (quickPick as any).buttons = options.buttons;

            return {
                quickPick,
                selection: selectionPromise.promise
            };
        };

        kernelSelector = new KernelSelector(
            instance(workspaceService),
            instance(notebook),
            provider,
            cancellation.token
        );
        disposables.push(kernelSelector);
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => disposeAllDisposables(disposables));
    function verifyExistenceOfConnectionsInQuickPick(
        quickPickItems: ConnectionQuickPickItem[],
        connections: KernelConnectionMetadata[]
    ) {
        const connectionsInQuickPick = quickPickItems.map((item) => item.connection.id);
        const expectedConnections = connections.map((item) => item.id);
        assert.equal(
            quickPickItems.length,
            connections.length,
            `Invalid number of connections in quick pick, expected ${expectedConnections} but displayed ${connectionsInQuickPick}`
        );
        connections.forEach((c) => {
            assert.isTrue(
                quickPickItems.some((item) => item.connection.id === c.id),
                `Connection ${c.id} not found in quick pick, what we have are ${connectionsInQuickPick}`
            );
        });
    }
    test('Quick Pick is displayed', async () => {
        when(kernelFinder.displayName).thenReturn('Kernel Finder');
        selectionPromise.resolve({ label: '' });

        const kernelConnection = await kernelSelector.selectKernel(quickPickFactory);
        await clock.runAllAsync();

        assert.isUndefined(kernelConnection?.selection);
        assert.isTrue(quickPickCreated);
    });
    test('Nothing is selected if cancelled', async () => {
        when(kernelFinder.displayName).thenReturn('Kernel Finder');

        const kernelConnectionPromise = kernelSelector.selectKernel(quickPickFactory);
        cancellation.cancel();
        selectionPromise.resolve({ connection: localPythonKernelSpec, label: '' });
        await clock.runAllAsync();

        assert.isUndefined((await kernelConnectionPromise)?.selection);
        assert.isTrue(quickPickCreated);
    });
    test('Display quick pick with Local kernel Specs', async () => {
        provider.kernels = [localPythonKernelSpec, localJavaKernelSpec, localJuliaKernelSpec];
        provider.kind = ContributedKernelFinderKind.LocalKernelSpec;
        when(kernelFinder.displayName).thenReturn('Kernel Finder');
        when(kernelFinder.kind).thenReturn(provider.kind);
        selectionPromise.resolve({ label: '' });

        const kernelConnection = await kernelSelector.selectKernel(quickPickFactory);
        await clock.runAllAsync();

        assert.isUndefined(kernelConnection?.selection);
        assert.strictEqual(options.items.length, 4);
        assert.strictEqual(options.items[0].label, DataScience.kernelCategoryForJupyterKernel);

        const last3QuickPickItems = options.items.slice(1) as ConnectionQuickPickItem[];
        verifyExistenceOfConnectionsInQuickPick(last3QuickPickItems, provider.kernels);
    });
    test('Display quick pick with Local Python Kernels', async () => {
        provider.kernels = [venvPythonKernel, condaKernel];
        provider.kind = ContributedKernelFinderKind.LocalPythonEnvironment;
        when(kernelFinder.displayName).thenReturn('Kernel Finder');
        when(kernelFinder.kind).thenReturn(provider.kind);
        selectionPromise.resolve({ label: '' });

        const kernelConnection = await kernelSelector.selectKernel(quickPickFactory);
        await clock.runAllAsync();

        assert.isUndefined(kernelConnection?.selection);
        assert.strictEqual(
            options.items.length,
            5,
            `Expected 5 items, Found ${options.items.map((item) => item.label)}`
        );

        const nonConnectionItems = options.items.filter((item) => !isKernelPickItem(item));
        assert.strictEqual(nonConnectionItems[0].label, `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`);
        assert.strictEqual(nonConnectionItems[1].label, DataScience.kernelCategoryForConda);
        assert.strictEqual(nonConnectionItems[2].label, DataScience.kernelCategoryForVirtual);

        const connectionItems = options.items.filter((item) => isKernelPickItem(item)) as ConnectionQuickPickItem[];
        verifyExistenceOfConnectionsInQuickPick(connectionItems, provider.kernels);
    });
    test('Dynamically update quick pick and update busy indicator', async () => {
        provider.kernels = [venvPythonKernel];
        provider.kind = ContributedKernelFinderKind.LocalPythonEnvironment;
        when(kernelFinder.displayName).thenReturn('Kernel Finder');
        when(kernelFinder.kind).thenReturn(provider.kind);

        kernelSelector.selectKernel(quickPickFactory).catch(noop);
        onDidChangeProvider.fire();
        await clock.runAllAsync();

        assert.strictEqual(quickPick.items.length, 3);
        assert.strictEqual(quickPick.items[0].label, `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`);
        assert.strictEqual(quickPick.items[1].label, DataScience.kernelCategoryForVirtual);
        verifyExistenceOfConnectionsInQuickPick(options.items.slice(2) as ConnectionQuickPickItem[], provider.kernels);

        // Update the items.
        provider.status = 'discovering';
        provider.kernels = [venvPythonKernel, condaKernel];
        onDidChangeProvider.fire();
        onDidChangeProviderStatus.fire();
        await clock.runAllAsync();

        assert.strictEqual(quickPick.busy, true);
        let nonConnectionItems = quickPick.items.filter((item) => !isKernelPickItem(item));
        assert.strictEqual(nonConnectionItems.length, 3);
        assert.strictEqual(nonConnectionItems[0].label, `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`);
        assert.strictEqual(nonConnectionItems[1].label, DataScience.kernelCategoryForConda);
        assert.strictEqual(nonConnectionItems[2].label, DataScience.kernelCategoryForVirtual);
        verifyExistenceOfConnectionsInQuickPick(
            quickPick.items.filter((item) => isKernelPickItem(item)) as ConnectionQuickPickItem[],
            provider.kernels
        );

        // Update the items again.
        provider.status = 'idle';
        provider.kernels = [venvPythonKernel, condaKernel, sysPythonKernel];
        onDidChangeProvider.fire();
        onDidChangeProviderStatus.fire();
        await clock.runAllAsync();

        nonConnectionItems = quickPick.items.filter((item) => !isKernelPickItem(item));
        assert.strictEqual(nonConnectionItems.length, 4);
        assert.strictEqual(nonConnectionItems[0].label, `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`);
        assert.strictEqual(nonConnectionItems[1].label, DataScience.kernelCategoryForConda);
        assert.strictEqual(nonConnectionItems[2].label, DataScience.kernelCategoryForGlobal);
        assert.strictEqual(nonConnectionItems[3].label, DataScience.kernelCategoryForVirtual);
        verifyExistenceOfConnectionsInQuickPick(
            quickPick.items.filter((item) => isKernelPickItem(item)) as ConnectionQuickPickItem[],
            provider.kernels
        );

        // Remove an item
        provider.status = 'idle';
        provider.kernels = [sysPythonKernel];
        onDidChangeProvider.fire();
        onDidChangeProviderStatus.fire();
        await clock.runAllAsync();

        nonConnectionItems = quickPick.items.filter((item) => !isKernelPickItem(item));
        assert.strictEqual(nonConnectionItems.length, 2);
        assert.strictEqual(nonConnectionItems[0].label, `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`);
        assert.strictEqual(nonConnectionItems[1].label, DataScience.kernelCategoryForGlobal);
        verifyExistenceOfConnectionsInQuickPick(
            quickPick.items.filter((item) => isKernelPickItem(item)) as ConnectionQuickPickItem[],
            provider.kernels
        );
    });
    test('Update labels in quick pick when the label (display name of kernel spec or python version) of a connection changes', async () => {
        provider.kernels = [venvPythonKernel, condaKernel, sysPythonKernel];
        provider.kind = ContributedKernelFinderKind.LocalPythonEnvironment;
        when(kernelFinder.displayName).thenReturn('Kernel Finder');
        when(kernelFinder.kind).thenReturn(provider.kind);
        when(kernelFinder.kernels).thenReturn(provider.kernels);

        kernelSelector.selectKernel(quickPickFactory).catch(noop);
        onDidChangeProvider.fire();
        await clock.runAllAsync();

        const displayNameOfConda = getDisplayNameOrNameOfKernelConnection(condaKernel);
        const displayNameOfVenv = getDisplayNameOrNameOfKernelConnection(venvPythonKernel);
        const displayNameOfSys = getDisplayNameOrNameOfKernelConnection(sysPythonKernel);
        assert.strictEqual(
            quickPick.items.find((item) => isKernelPickItem(item) && item.connection.id === condaKernel.id)?.label,
            displayNameOfConda
        );
        assert.strictEqual(
            quickPick.items.find((item) => isKernelPickItem(item) && item.connection.id === venvPythonKernel.id)?.label,
            displayNameOfVenv
        );
        assert.strictEqual(
            quickPick.items.find((item) => isKernelPickItem(item) && item.connection.id === sysPythonKernel.id)?.label,
            displayNameOfSys
        );

        // Update the version of Conda & sys
        condaKernel.interpreter.version = { major: 4, minor: 5, patch: 6, raw: '4.5.6' };
        sysPythonKernel.interpreter.version = { major: 4, minor: 5, patch: 6, raw: '4.5.6' };
        const newDisplayNameOfConda = getDisplayNameOrNameOfKernelConnection(condaKernel);
        const newDisplayNameOfVenv = getDisplayNameOrNameOfKernelConnection(venvPythonKernel);
        const newDisplayNameOfSys = getDisplayNameOrNameOfKernelConnection(sysPythonKernel);

        // Verify the labels will be different.
        assert.notStrictEqual(displayNameOfConda, newDisplayNameOfConda);
        assert.notStrictEqual(displayNameOfSys, newDisplayNameOfSys);
        // Verify venv still has the same display name.
        assert.strictEqual(displayNameOfVenv, newDisplayNameOfVenv);

        // Trigger a change
        onDidChangeProvider.fire();

        //Verify the labels have been updated to reflect the new version.
        assert.strictEqual(
            quickPick.items.find((item) => isKernelPickItem(item) && item.connection.id === condaKernel.id)?.label,
            newDisplayNameOfConda
        );
        assert.strictEqual(
            quickPick.items.find((item) => isKernelPickItem(item) && item.connection.id === venvPythonKernel.id)?.label,
            displayNameOfVenv
        );
        assert.strictEqual(
            quickPick.items.find((item) => isKernelPickItem(item) && item.connection.id === sysPythonKernel.id)?.label,
            newDisplayNameOfSys
        );
    });
});
