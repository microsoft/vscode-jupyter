/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { Kernel, Session } from '@jupyterlab/services';
import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { getDisplayNameOrNameOfKernelConnection } from '../../../platform/../kernels/helpers.node';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { MockMemento } from '../../mocks/mementos';
import { CryptoUtils } from '../../../platform/common/crypto.node';
import { noop } from '../../core';
import { IJupyterConnection, IJupyterKernelSpec, LiveKernelConnectionMetadata } from '../../../kernels/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts.node';
import { JupyterSessionManager } from '../../../kernels/jupyter/session/jupyterSessionManager.node';
import { JupyterSessionManagerFactory } from '../../../kernels/jupyter/session/jupyterSessionManagerFactory.node';
import { RemoteKernelFinder } from '../../../kernels/raw/finder/remoteKernelFinder.node';
import { IRemoteKernelFinder } from '../../../kernels/raw/types';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/raw/finder/preferredRemoteKernelIdProvider.node';
import { IJupyterKernel, IJupyterSessionManager } from '../../../kernels/jupyter/types';

suite(`Remote Kernel Finder`, () => {
    let disposables: Disposable[] = [];
    let preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider;
    let kernelFinder: IRemoteKernelFinder;
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
        rootDirectory: '.',
        dispose: noop
    };
    const defaultPython3Name = 'python3';
    const python3spec: IJupyterKernelSpec = {
        display_name: 'Python 3 on Disk',
        name: defaultPython3Name,
        argv: ['/usr/bin/python3'],
        language: 'python',
        path: 'specFilePath'
    };
    const python2spec: IJupyterKernelSpec = {
        display_name: 'Python 2 on Disk',
        name: 'python2',
        argv: ['/usr/bin/python'],
        language: 'python',
        path: 'specFilePath'
    };
    const juliaSpec: IJupyterKernelSpec = {
        display_name: 'Julia on Disk',
        name: 'julia',
        argv: ['/usr/bin/julia'],
        language: 'julia',
        path: 'specFilePath'
    };
    const interpreterSpec: IJupyterKernelSpec = {
        display_name: 'Conda interpreter kernel',
        name: defaultPython3Name,
        argv: ['python'],
        language: 'python',
        path: 'specFilePath'
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

        kernelFinder = new RemoteKernelFinder(
            disposables,
            preferredRemoteKernelIdProvider,
            instance(jupyterSessionManagerFactory),
            instance(interpreterService)
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
        const kernels = await kernelFinder.listKernels(undefined, connInfo);
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
        const kernels = await kernelFinder.listKernels(undefined, connInfo);
        const liveKernels = kernels.filter((k) => k.kind === 'connectToLiveKernel');
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
        let kernels = await kernelFinder.listKernels(undefined, connInfo);
        let liveKernels = kernels.filter((k) => k.kind === 'connectToLiveKernel');

        // Should skip one
        assert.equal(liveKernels.length, 2, 'Restart session was included');

        // Mark it as used
        sessionUsedEvent.fire({ id: python3Kernels[0].id, clientId: python3Kernels[0].id } as any);
        kernels = await kernelFinder.listKernels(undefined, connInfo);
        liveKernels = kernels.filter((k) => k.kind === 'connectToLiveKernel');
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
        let kernel = await kernelFinder.findKernel(undefined, connInfo, {
            language_info: { name: PYTHON_LANGUAGE },
            orig_nbformat: 4
        });
        assert.ok(kernel, 'No python kernel found matching notebook metadata');

        // Julia
        kernel = await kernelFinder.findKernel(undefined, connInfo, {
            language_info: { name: 'julia' },
            orig_nbformat: 4
        });
        assert.ok(kernel, 'No julia kernel found matching notebook metadata');

        // Python 2
        kernel = await kernelFinder.findKernel(undefined, connInfo, {
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

        const kernel = await kernelFinder.findKernel(uri, connInfo);
        assert.ok(kernel, 'Kernel not found for uri');
        assert.equal(kernel?.kind, 'connectToLiveKernel', 'Live kernel not found');
        assert.equal(
            (kernel as LiveKernelConnectionMetadata).kernelModel.name,
            python3Kernels[1].name,
            'Wrong live kernel returned'
        );
    });
});
