// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationTokenSource, Disposable, EventEmitter, QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata, RemoteKernelSpecConnectionMetadata } from '../../../kernels/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, ReadWrite } from '../../../platform/common/types';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import {
    IQuickPickParameters,
    MultiStepInputQuickPicResponseType
} from '../../../platform/common/utils/multiStepInput';
import { ServiceContainer } from '../../../platform/ioc/container';
import { noop } from '../../../test/core';
import { getKernelConnectionCategorySync } from '../connectionDisplayData';
import { RemoteKernelSelector } from './remoteKernelSelector';
import { ConnectionQuickPickItem, IQuickPickKernelItemProvider } from './types';
import { IConnectionDisplayData, IConnectionDisplayDataProvider } from '../types';
import { CreateAndSelectItemFromQuickPick, isKernelPickItem } from './baseKernelSelector';

suite('Remote Kernel Selector', () => {
    let kernelSelector: RemoteKernelSelector;
    let clock: fakeTimers.InstalledClock;
    let onDidChangeProvider: EventEmitter<void>;
    let onDidChangeProviderStatus: EventEmitter<void>;
    let onDidChangeRecommended: EventEmitter<void>;
    let onDidFailToListKernels: EventEmitter<Error>;
    const disposables: IDisposable[] = [];
    let cancellation: CancellationTokenSource;
    let displayDataProvider: IConnectionDisplayDataProvider;
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

    let remotePythonKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        id: 'remotePythonKernelSpec',
        kernelSpec: {
            argv: [],
            display_name: 'Remote Python Kernel Spec',
            executable: ',',
            name: 'remotePythonKernelSpec',
            language: 'python'
        },
        baseUrl: 'http://localhost:8888',
        serverId: 'serverId'
    });
    let remoteJavaKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        id: 'localJavaKernelSpec',
        kernelSpec: {
            argv: [],
            display_name: 'Local Java Kernel Spec',
            executable: '',
            name: 'localJavaKernelSpec',
            language: 'java'
        },
        baseUrl: 'http://localhost:8888',
        serverId: 'serverId'
    });
    let remoteJuliaKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        id: 'localJuliaKernelSpec',
        kernelSpec: {
            argv: [],
            display_name: 'Local Julia Kernel Spec',
            executable: '',
            name: 'localJuliaKernelSpec',
            language: 'julia'
        },
        baseUrl: 'http://localhost:8888',
        serverId: 'serverId'
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

        kernelFinder = mock<IContributedKernelFinder<KernelConnectionMetadata>>();
        displayDataProvider = mock<IConnectionDisplayDataProvider>();
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
        when(serviceContainer.get<IConnectionDisplayDataProvider>(IConnectionDisplayDataProvider)).thenReturn(
            instance(displayDataProvider)
        );
        const onDidChange = new EventEmitter<IConnectionDisplayData>();
        disposables.push(onDidChange);
        when(displayDataProvider.getDisplayData(anything())).thenCall((c: KernelConnectionMetadata) => {
            return <IConnectionDisplayData>{
                category: getKernelConnectionCategorySync(c),
                label: getDisplayNameOrNameOfKernelConnection(c),
                connectionId: c.id,
                description: c.id,
                detail: c.id,
                onDidChange: onDidChange.event
            };
        });
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

        kernelSelector = new RemoteKernelSelector(provider, cancellation.token);
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
        selectionPromise.resolve({ connection: remotePythonKernelSpec, label: '' });
        await clock.runAllAsync();

        assert.isUndefined((await kernelConnectionPromise)?.selection);
        assert.isTrue(quickPickCreated);
    });
    test('Display quick pick with Remote kernel Specs', async () => {
        provider.kernels = [remotePythonKernelSpec];
        provider.kind = ContributedKernelFinderKind.LocalKernelSpec;
        when(kernelFinder.displayName).thenReturn('Kernel Finder');
        when(kernelFinder.kind).thenReturn(provider.kind);
        selectionPromise.resolve({ label: '' });

        const kernelConnection = await kernelSelector.selectKernel(quickPickFactory);
        await clock.runAllAsync();

        assert.isUndefined(kernelConnection?.selection);
        assert.strictEqual(options.items.length, 2);

        const last3QuickPickItems = options.items.slice(1) as ConnectionQuickPickItem[];
        verifyExistenceOfConnectionsInQuickPick(last3QuickPickItems, provider.kernels);
    });
    test('Dynamically update quick pick and update busy indicator', async () => {
        provider.kernels = [remotePythonKernelSpec];
        provider.kind = ContributedKernelFinderKind.LocalPythonEnvironment;
        when(kernelFinder.displayName).thenReturn('Kernel Finder');
        when(kernelFinder.kind).thenReturn(provider.kind);

        kernelSelector.selectKernel(quickPickFactory).catch(noop);
        onDidChangeProvider.fire();
        await clock.runAllAsync();

        assert.strictEqual(quickPick.items.length, 2);
        assert.strictEqual(quickPick.items[1].label, remotePythonKernelSpec.kernelSpec.display_name);
        verifyExistenceOfConnectionsInQuickPick(options.items.slice(1) as ConnectionQuickPickItem[], provider.kernels);

        // Update the items.
        provider.status = 'discovering';
        provider.kernels = [remotePythonKernelSpec, remoteJavaKernelSpec];
        onDidChangeProvider.fire();
        onDidChangeProviderStatus.fire();
        await clock.runAllAsync();

        assert.strictEqual(quickPick.busy, true);
        let connectionItems = quickPick.items.filter((item) => isKernelPickItem(item));
        assert.strictEqual(connectionItems.length, 2);
        assert.strictEqual(connectionItems[0].label, remoteJavaKernelSpec.kernelSpec.display_name);
        assert.strictEqual(connectionItems[1].label, remotePythonKernelSpec.kernelSpec.display_name);
        verifyExistenceOfConnectionsInQuickPick(
            quickPick.items.filter((item) => isKernelPickItem(item)) as ConnectionQuickPickItem[],
            provider.kernels
        );

        // Update the items again.
        provider.status = 'idle';
        provider.kernels = [remotePythonKernelSpec, remoteJavaKernelSpec, remoteJuliaKernelSpec];
        onDidChangeProvider.fire();
        onDidChangeProviderStatus.fire();
        await clock.runAllAsync();

        connectionItems = quickPick.items.filter((item) => isKernelPickItem(item));
        assert.strictEqual(connectionItems.length, 3);
        assert.strictEqual(connectionItems[0].label, remoteJavaKernelSpec.kernelSpec.display_name);
        assert.strictEqual(connectionItems[1].label, remoteJuliaKernelSpec.kernelSpec.display_name);
        assert.strictEqual(connectionItems[2].label, remotePythonKernelSpec.kernelSpec.display_name);
        verifyExistenceOfConnectionsInQuickPick(
            quickPick.items.filter((item) => isKernelPickItem(item)) as ConnectionQuickPickItem[],
            provider.kernels
        );

        // Remove an item
        provider.status = 'idle';
        provider.kernels = [remoteJavaKernelSpec];
        onDidChangeProvider.fire();
        onDidChangeProviderStatus.fire();
        await clock.runAllAsync();

        connectionItems = quickPick.items.filter((item) => isKernelPickItem(item));
        assert.strictEqual(connectionItems.length, 1);
        assert.strictEqual(quickPick.items[1].label, remoteJavaKernelSpec.kernelSpec.display_name);
        verifyExistenceOfConnectionsInQuickPick(
            quickPick.items.filter((item) => isKernelPickItem(item)) as ConnectionQuickPickItem[],
            provider.kernels
        );
    });
});
