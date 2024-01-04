// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as sinon from 'sinon';
import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { noop } from '../../../test/core';
import { IJupyterConnection, IKernelProvider } from '../../types';
import {
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerProviderRegistry,
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    JupyterServerProviderHandle
} from '../types';
import { KernelFinder } from '../../kernelFinder';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { IExtensionContext } from '../../../platform/common/types';
import { RemoteKernelFinder } from './remoteKernelFinder';
import { JupyterConnection } from '../connection/jupyterConnection';
import { DisposableStore, dispose } from '../../../platform/common/utils/lifecycle';
import { IFileSystem } from '../../../platform/common/platform/types';
import { RemoteKernelFinderController } from './remoteKernelFinderController';
import { JupyterServerCollection, JupyterServerProvider } from '../../../api';
import { UserJupyterServerPickerProviderId } from '../../../platform/constants';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../../test/constants';

suite(`Remote Kernel Finder Controller`, () => {
    let disposables: Disposable[] = [];
    const connInfo: IJupyterConnection = {
        baseUrl: 'http://foobar',
        displayName: 'foobar connection',
        token: '',
        providerId: 'a',
        hostName: 'foobar',
        rootDirectory: Uri.file('.'),
        dispose: noop,
        serverProviderHandle: { handle: 'handle', id: 'id', extensionId: '' },
        settings: {} as any
    };
    const globalStorageUri = Uri.file('globalStorage');
    const serverEntry = {
        uri: connInfo.baseUrl,
        time: Date.now(),
        isValidated: true,
        provider: {
            id: UserJupyterServerPickerProviderId,
            handle: '2',
            extensionId: JVSC_EXTENSION_ID_FOR_TESTS
        }
    };
    let serverUriStorage: IJupyterServerUriStorage;
    let env: IApplicationEnvironment;
    let cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator;
    let kernelFinder: KernelFinder;
    let kernelProvider: IKernelProvider;
    let jupyterConnection: JupyterConnection;
    let fs: IFileSystem;
    let context: IExtensionContext;
    let jupyterServerProviderRegistry: IJupyterServerProviderRegistry;
    let kernelFinderController: RemoteKernelFinderController;
    let disposableStore: DisposableStore;
    let clock: fakeTimers.InstalledClock;
    setup(() => {
        clock = fakeTimers.install();
        disposableStore = new DisposableStore();
        disposables.push(disposableStore);
        disposableStore.add(new Disposable(() => clock.uninstall()));

        serverUriStorage = mock<IJupyterServerUriStorage>();
        when(serverUriStorage.all).thenReturn([]);
        when(serverUriStorage.onDidAdd).thenReturn(
            disposableStore.add(new EventEmitter<IJupyterServerUriEntry>()).event
        );
        when(serverUriStorage.onDidChange).thenReturn(disposableStore.add(new EventEmitter<void>()).event);
        when(serverUriStorage.onDidLoad).thenReturn(disposableStore.add(new EventEmitter<void>()).event);
        when(serverUriStorage.onDidRemove).thenReturn(
            disposableStore.add(new EventEmitter<JupyterServerProviderHandle[]>()).event
        );

        env = mock<IApplicationEnvironment>();
        cachedRemoteKernelValidator = mock<IJupyterRemoteCachedKernelValidator>();
        kernelFinder = mock<KernelFinder>();
        kernelProvider = mock<IKernelProvider>();
        jupyterConnection = mock<JupyterConnection>();
        fs = mock<IFileSystem>();
        context = mock<IExtensionContext>();
        jupyterServerProviderRegistry = mock<IJupyterServerProviderRegistry>();
        when(jupyterServerProviderRegistry.onDidChangeCollections).thenReturn(
            disposableStore.add(
                new EventEmitter<{
                    added: JupyterServerCollection[];
                    removed: JupyterServerCollection[];
                }>()
            ).event
        );
        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([]);
        when(kernelFinder.registerKernelFinder(anything())).thenReturn(new Disposable(noop));
        when(context.globalStorageUri).thenReturn(globalStorageUri);
        kernelFinderController = new RemoteKernelFinderController(
            instance(serverUriStorage),
            instance(env),
            instance(cachedRemoteKernelValidator),
            instance(kernelFinder),
            instance(kernelProvider),
            instance(jupyterConnection),
            disposables,
            instance(fs),
            instance(context),
            instance(jupyterServerProviderRegistry)
        );
    });
    teardown(() => {
        sinon.restore();
        disposables = dispose(disposables);
    });
    test('Do not use old API for user provided kernels', async () => {
        let displayNameOfKernelProvider = '';
        sinon.stub(RemoteKernelFinder.prototype, 'activate').callsFake(function (this: RemoteKernelFinder) {
            displayNameOfKernelProvider = this.displayName;
            return Promise.resolve();
        });
        const collectionForRemote = mock<JupyterServerCollection>();
        when(collectionForRemote.id).thenReturn(UserJupyterServerPickerProviderId);
        when(collectionForRemote.label).thenReturn('Quick Label');
        when(collectionForRemote.extensionId).thenReturn(JVSC_EXTENSION_ID_FOR_TESTS);
        const serverProvider = mock<JupyterServerProvider>();
        when(serverProvider.provideJupyterServers(anything())).thenResolve();
        when(collectionForRemote.serverProvider).thenReturn(instance(serverProvider));

        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([instance(collectionForRemote)]);
        when(serverUriStorage.all).thenReturn([serverEntry]);

        kernelFinderController.activate();
        await clock.runAllAsync();

        assert.isEmpty(displayNameOfKernelProvider, 'Old API should not be used for user provided kernels');
    });
});
