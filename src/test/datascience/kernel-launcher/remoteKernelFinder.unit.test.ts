/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { Kernel, Session } from '@jupyterlab/services';
import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { MockMemento } from '../../mocks/mementos';
import { CryptoUtils } from '../../../platform/common/crypto';
import { noop } from '../../core';
import {
    IJupyterConnection,
    IJupyterKernelSpec,
    IKernelFinder,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../../kernels/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { JupyterSessionManager } from '../../../kernels/jupyter/session/jupyterSessionManager';
import { JupyterSessionManagerFactory } from '../../../kernels/jupyter/session/jupyterSessionManagerFactory';
import { RemoteKernelFinder } from '../../../kernels/jupyter/remoteKernelFinder';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../../kernels/raw/types';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/raw/finder/preferredRemoteKernelIdProvider';
import { IJupyterKernel, IJupyterSessionManager } from '../../../kernels/jupyter/types';
import { KernelFinder } from '../../../kernels/kernelFinder.node';
import { NotebookProvider } from '../../../kernels/jupyter/launcher/notebookProvider';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { LocalKernelFinder } from '../../../kernels/raw/finder/localKernelFinder.node';
import { IFileSystem } from '../../../platform/common/platform/types.node';
import { JupyterServerUriStorage } from '../../../kernels/jupyter/launcher/serverUriStorage';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { RemoteKernelSpecsCacheKey } from '../../../kernels/kernelFinder.base';
import { takeTopRankKernel } from './localKernelFinder.unit.test';

suite(`Remote Kernel Finder`, () => {
    let disposables: Disposable[] = [];
    let preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider;
    let remoteKernelFinder: IRemoteKernelFinder;
    let localKernelFinder: ILocalKernelFinder;
    let kernelFinder: IKernelFinder;
    let fs: IFileSystem;
    let memento: MockMemento;
    let jupyterSessionManager: IJupyterSessionManager;
    const dummyEvent = new EventEmitter<number>();
    let interpreterService: IInterpreterService;
    let sessionCreatedEvent: EventEmitter<Kernel.IKernelConnection>;
    let sessionUsedEvent: EventEmitter<Kernel.IKernelConnection>;
    const connInfo: IJupyterConnection = {
        type: 'jupyter',
        localLaunch: false,
        baseUrl: 'http://foobar',
        displayName: 'foobar connection',
        disconnected: dummyEvent.event,
        token: '',
        hostName: 'foobar',
        rootDirectory: Uri.file('.'),
        dispose: noop
    };
    const defaultPython3Name = 'python3';
    const python3spec: IJupyterKernelSpec = {
        display_name: 'Python 3 on Disk',
        name: defaultPython3Name,
        argv: ['/usr/bin/python3'],
        language: 'python',
        executable: 'specFilePath'
    };
    const python2spec: IJupyterKernelSpec = {
        display_name: 'Python 2 on Disk',
        name: 'python2',
        argv: ['/usr/bin/python'],
        language: 'python',
        executable: 'specFilePath'
    };
    const juliaSpec: IJupyterKernelSpec = {
        display_name: 'Julia on Disk',
        name: 'julia',
        argv: ['/usr/bin/julia'],
        language: 'julia',
        executable: 'specFilePath'
    };
    const interpreterSpec: IJupyterKernelSpec = {
        display_name: 'Conda interpreter kernel',
        name: defaultPython3Name,
        argv: ['python'],
        language: 'python',
        executable: 'specFilePath'
    };
    const python3Kernels: IJupyterKernel[] = ['1', '2', '3'].map((id) => {
        return {
            name: python3spec.display_name,
            lastActivityTime: new Date(),
            numberOfConnections: 1,
            id
        };
    });
    const python3Sessions: Session.IModel[] = ['S1', 'S2', 'S3'].map((sid, i) => {
        return {
            id: sid,
            name: sid,
            path: '.',
            type: '',
            kernel: {
                id: python3Kernels[i].id!,
                name: python3Kernels[i].name,
                model: {}
            }
        };
    });

    setup(() => {
        const crypto = mock(CryptoUtils);
        when(crypto.createHash(anything(), anything())).thenCall((d, _c) => {
            return d.toLowerCase();
        });
        preferredRemoteKernelIdProvider = new PreferredRemoteKernelIdProvider(new MockMemento(), instance(crypto));
        jupyterSessionManager = mock(JupyterSessionManager);
        const jupyterSessionManagerFactory = mock(JupyterSessionManagerFactory);
        when(jupyterSessionManagerFactory.create(anything())).thenResolve(instance(jupyterSessionManager));
        sessionCreatedEvent = new EventEmitter<Kernel.IKernelConnection>();
        sessionUsedEvent = new EventEmitter<Kernel.IKernelConnection>();
        when(jupyterSessionManagerFactory.onRestartSessionCreated).thenReturn(sessionCreatedEvent.event);
        when(jupyterSessionManagerFactory.onRestartSessionUsed).thenReturn(sessionUsedEvent.event);
        interpreterService = mock<IInterpreterService>();
        localKernelFinder = mock(LocalKernelFinder);
        when(localKernelFinder.listKernels(anything(), anything())).thenResolve([]);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

        remoteKernelFinder = new RemoteKernelFinder(
            disposables,
            instance(jupyterSessionManagerFactory),
            instance(interpreterService),
            instance(extensionChecker),
            false
        );

        const configService = mock(ConfigurationService);
        const dsSettings = {
            jupyterServerType: 'remote'
        } as any;
        when(configService.getSettings(anything())).thenReturn(dsSettings as any);
        const notebookProvider = mock(NotebookProvider);
        when(notebookProvider.connect(anything())).thenResolve(connInfo);
        fs = mock(FileSystem);
        when(fs.deleteLocalFile(anything())).thenResolve();
        when(fs.localFileExists(anything())).thenResolve(true);
        const serverUriStorage = mock(JupyterServerUriStorage);
        when(serverUriStorage.getUri()).thenResolve(connInfo.baseUrl);
        memento = new MockMemento();
        kernelFinder = new KernelFinder(
            instance(localKernelFinder),
            remoteKernelFinder,
            instance(extensionChecker),
            instance(interpreterService),
            preferredRemoteKernelIdProvider,
            instance(notebookProvider),
            instance(configService),
            memento,
            instance(fs),
            instance(serverUriStorage)
        );
    });
    teardown(() => {
        disposables.forEach((d) => d.dispose());
    });
    test('Kernels found', async () => {
        when(jupyterSessionManager.getRunningKernels()).thenResolve([]);
        when(jupyterSessionManager.getRunningSessions()).thenResolve([]);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([
            python3spec,
            python2spec,
            juliaSpec,
            interpreterSpec
        ]);
        const kernels = await remoteKernelFinder.listKernels(undefined, connInfo);
        assert.equal(kernels.length, 4, 'Not enough kernels returned');
        assert.equal(
            getDisplayNameOrNameOfKernelConnection(kernels[0]),
            'Python 3 on Disk',
            'Did not find correct python kernel'
        );
        assert.equal(
            getDisplayNameOrNameOfKernelConnection(kernels[1]),
            'Python 2 on Disk',
            'Did not find correct python 2 kernel'
        );
        assert.equal(
            getDisplayNameOrNameOfKernelConnection(kernels[2]),
            'Julia on Disk',
            'Did not find correct julia kernel'
        );
    });
    test('Live sessions', async () => {
        when(jupyterSessionManager.getRunningKernels()).thenResolve(python3Kernels);
        when(jupyterSessionManager.getRunningSessions()).thenResolve(python3Sessions);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([
            python3spec,
            python2spec,
            juliaSpec,
            interpreterSpec
        ]);
        const kernels = await remoteKernelFinder.listKernels(undefined, connInfo);
        const liveKernels = kernels.filter((k) => k.kind === 'connectToLiveRemoteKernel');
        assert.equal(liveKernels.length, 3, 'Live kernels not found');
    });

    test('Restart sessions are ignored', async () => {
        when(jupyterSessionManager.getRunningKernels()).thenResolve(python3Kernels);
        when(jupyterSessionManager.getRunningSessions()).thenResolve(python3Sessions);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([
            python3spec,
            python2spec,
            juliaSpec,
            interpreterSpec
        ]);
        sessionCreatedEvent.fire({ id: python3Kernels[0].id, clientId: python3Kernels[0].id } as any);
        let kernels = await remoteKernelFinder.listKernels(undefined, connInfo);
        let liveKernels = kernels.filter((k) => k.kind === 'connectToLiveRemoteKernel');

        // Should skip one
        assert.equal(liveKernels.length, 2, 'Restart session was included');

        // Mark it as used
        sessionUsedEvent.fire({ id: python3Kernels[0].id, clientId: python3Kernels[0].id } as any);
        kernels = await remoteKernelFinder.listKernels(undefined, connInfo);
        liveKernels = kernels.filter((k) => k.kind === 'connectToLiveRemoteKernel');
        assert.equal(liveKernels.length, 3, 'Restart session was not included');
    });

    test('Can match based on notebook metadata', async () => {
        when(jupyterSessionManager.getRunningKernels()).thenResolve(python3Kernels);
        when(jupyterSessionManager.getRunningSessions()).thenResolve(python3Sessions);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([
            python3spec,
            python2spec,
            juliaSpec,
            interpreterSpec
        ]);

        // Try python
        let kernel = await kernelFinder.rankKernels(undefined, {
            language_info: { name: PYTHON_LANGUAGE },
            orig_nbformat: 4
        });
        assert.ok(kernel, 'No python kernel found matching notebook metadata');

        // Julia
        kernel = await kernelFinder.rankKernels(undefined, {
            language_info: { name: 'julia' },
            orig_nbformat: 4
        });
        assert.ok(kernel, 'No julia kernel found matching notebook metadata');

        // Python 2
        kernel = await kernelFinder.rankKernels(undefined, {
            kernelspec: {
                display_name: 'Python 2 on Disk',
                name: 'python2'
            },
            language_info: { name: PYTHON_LANGUAGE },
            orig_nbformat: 4
        });
        assert.ok(kernel, 'No python2 kernel found matching notebook metadata');
    });
    test('Can match based on session id', async () => {
        when(jupyterSessionManager.getRunningKernels()).thenResolve(python3Kernels);
        when(jupyterSessionManager.getRunningSessions()).thenResolve(python3Sessions);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([
            python3spec,
            python2spec,
            juliaSpec,
            interpreterSpec
        ]);
        const uri = Uri.file('/usr/foobar/foo.ipynb');
        await preferredRemoteKernelIdProvider.storePreferredRemoteKernelId(uri, '2');

        const kernel = takeTopRankKernel(await kernelFinder.rankKernels(uri));
        assert.ok(kernel, 'Kernel not found for uri');
        assert.equal(kernel?.kind, 'connectToLiveRemoteKernel', 'Live kernel not found');
        assert.equal(
            (kernel as LiveRemoteKernelConnectionMetadata).kernelModel.name,
            python3Kernels[1].name,
            'Wrong live kernel returned'
        );
    });
    test('Invalid kernels not returned', async () => {
        const validKernel: RemoteKernelSpecConnectionMetadata = {
            kernelSpec: python3spec,
            baseUrl: connInfo.baseUrl,
            kind: 'startUsingRemoteKernelSpec',
            id: '2'
        };
        const invalidKernel: RemoteKernelSpecConnectionMetadata = {
            kernelSpec: python3spec,
            baseUrl: 'dude',
            kind: 'startUsingRemoteKernelSpec',
            id: '3'
        };
        await memento.update(RemoteKernelSpecsCacheKey, [validKernel, invalidKernel]);
        const uri = Uri.file('/usr/foobar/foo.ipynb');
        await preferredRemoteKernelIdProvider.storePreferredRemoteKernelId(uri, '2');

        const kernels = await kernelFinder.listKernels(uri, undefined, 'useCache');
        assert.ok(kernels, 'Kernels not found for uri');
        assert.equal(kernels.length, 1, `Too many cached kernels`);
        assert.deepStrictEqual(kernels[0], validKernel, 'Wrong kernel returned from cache');
    });
});
