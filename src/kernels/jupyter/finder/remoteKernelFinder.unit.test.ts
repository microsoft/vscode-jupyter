// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Session } from '@jupyterlab/services';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { getDisplayNameOrNameOfKernelConnection } from '../../helpers';
import { Disposable, Uri } from 'vscode';
import { CryptoUtils } from '../../../platform/common/crypto';
import { noop, sleep } from '../../../test/core';
import {
    IJupyterConnection,
    IJupyterKernelSpec,
    IKernelProvider,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../types';
import { JupyterSessionManager } from '../session/jupyterSessionManager';
import { JupyterSessionManagerFactory } from '../session/jupyterSessionManagerFactory';
import { IJupyterKernel, IJupyterRemoteCachedKernelValidator, IJupyterSessionManager } from '../types';
import { KernelFinder } from '../../kernelFinder';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { IExtensionContext } from '../../../platform/common/types';
import { createEventHandler, TestEventHandler } from '../../../test/common';
import { CacheDataFormat, RemoteKernelFinder } from './remoteKernelFinder';
import { JupyterConnection } from '../connection/jupyterConnection';
import { dispose } from '../../../platform/common/helpers';
import { generateIdFromRemoteProvider } from '../jupyterUtils';
import { IFileSystem } from '../../../platform/common/platform/types';
import { uriEquals } from '../../../test/datascience/helpers';
import { RemoteKernelSpecCacheFileName } from '../constants';

suite(`Remote Kernel Finder`, () => {
    let disposables: Disposable[] = [];
    let remoteKernelFinder: RemoteKernelFinder;
    let kernelFinder: KernelFinder;
    let fs: IFileSystem;
    let jupyterSessionManager: IJupyterSessionManager;
    let cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator;
    let kernelsChanged: TestEventHandler<void>;
    let jupyterConnection: JupyterConnection;
    const connInfo: IJupyterConnection = {
        localLaunch: false,
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
    const globalStorageUri = Uri.file('globalStorage');
    const serverEntry = {
        uri: connInfo.baseUrl,
        time: Date.now(),
        isValidated: true,
        provider: {
            id: '1',
            handle: '2',
            extensionId: ''
        }
    };

    setup(() => {
        const context = mock<IExtensionContext>();
        when(context.globalStorageUri).thenReturn(globalStorageUri);
        fs = mock<IFileSystem>();
        const crypto = mock(CryptoUtils);
        when(crypto.createHash(anything(), anything())).thenCall((d, _c) => {
            return Promise.resolve(d.toLowerCase());
        });
        jupyterSessionManager = mock(JupyterSessionManager);
        when(jupyterSessionManager.dispose()).thenResolve();
        const jupyterSessionManagerFactory = mock(JupyterSessionManagerFactory);
        when(jupyterSessionManagerFactory.create(anything())).thenReturn(instance(jupyterSessionManager));
        when(fs.delete(anything())).thenResolve();
        when(fs.createDirectory(uriEquals(globalStorageUri))).thenResolve();
        when(fs.exists(anything())).thenResolve(true);
        when(fs.readFile(uriEquals(Uri.joinPath(globalStorageUri, RemoteKernelSpecCacheFileName)))).thenReject(
            new Error('File does not exist')
        );
        when(
            fs.writeFile(uriEquals(Uri.joinPath(globalStorageUri, RemoteKernelSpecCacheFileName)), anything())
        ).thenCall(async (_, data: string) => {
            when(fs.readFile(uriEquals(Uri.joinPath(globalStorageUri, RemoteKernelSpecCacheFileName)))).thenResolve(
                data
            );
        });
        cachedRemoteKernelValidator = mock<IJupyterRemoteCachedKernelValidator>();
        when(cachedRemoteKernelValidator.isValid(anything())).thenResolve(true);
        const env = mock<IApplicationEnvironment>();
        when(env.extensionVersion).thenReturn('');
        const kernelProvider = mock<IKernelProvider>();
        kernelFinder = new KernelFinder(disposables);
        kernelsChanged = createEventHandler(kernelFinder, 'onDidChangeKernels');
        disposables.push(kernelsChanged);
        jupyterConnection = mock<JupyterConnection>();
        when(jupyterConnection.createConnectionInfo(anything())).thenResolve(connInfo);
        remoteKernelFinder = new RemoteKernelFinder(
            'currentremote',
            'Local Kernels',
            instance(jupyterSessionManagerFactory),
            instance(env),
            instance(cachedRemoteKernelValidator),
            kernelFinder,
            instance(kernelProvider),
            serverEntry.provider,
            instance(jupyterConnection),
            instance(fs),
            instance(context)
        );
    });
    teardown(() => dispose(disposables));
    test('Kernels found', async () => {
        remoteKernelFinder.activate().then(noop, noop);

        when(jupyterSessionManager.getRunningKernels()).thenResolve([]);
        when(jupyterSessionManager.getRunningSessions()).thenResolve([]);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([
            python3spec,
            python2spec,
            juliaSpec,
            interpreterSpec
        ]);
        const kernels = await remoteKernelFinder.listKernelsFromConnection(connInfo);
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
        remoteKernelFinder.activate().then(noop, noop);

        when(jupyterSessionManager.getRunningKernels()).thenResolve(python3Kernels);
        when(jupyterSessionManager.getRunningSessions()).thenResolve(python3Sessions);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([
            python3spec,
            python2spec,
            juliaSpec,
            interpreterSpec
        ]);
        const kernels = await remoteKernelFinder.listKernelsFromConnection(connInfo);
        const liveKernels = kernels.filter((k) => k.kind === 'connectToLiveRemoteKernel');
        assert.equal(liveKernels.length, 3, 'Live kernels not found');
    });
    test('Do not return cached remote kernelspecs or live kernels (if the server is no longer valid)', async () => {
        const liveRemoteKernel = LiveRemoteKernelConnectionMetadata.create({
            baseUrl: 'baseUrl1',
            id: '1',
            kernelModel: {
                lastActivityTime: new Date(),
                model: {
                    id: '1',
                    name: '',
                    path: '',
                    type: '',
                    kernel: {
                        id: '1',
                        name: ''
                    }
                },
                name: '',
                numberOfConnections: 0
            },
            serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
        });
        const cachedKernels = [
            RemoteKernelSpecConnectionMetadata.create({
                baseUrl: 'baseUrl1',
                id: '2',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                },
                serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
            }).toJSON(),
            liveRemoteKernel.toJSON()
        ] as KernelConnectionMetadata[];
        when(cachedRemoteKernelValidator.isValid(anything())).thenResolve(false);

        const cacheKey = generateIdFromRemoteProvider(serverEntry.provider);
        when(fs.readFile(uriEquals(Uri.joinPath(globalStorageUri, RemoteKernelSpecCacheFileName)))).thenResolve(
            JSON.stringify(<CacheDataFormat>{ extensionVersion: '', data: { [cacheKey]: cachedKernels } })
        );
        when(jupyterSessionManager.getRunningKernels()).thenResolve([]);
        when(jupyterSessionManager.getRunningSessions()).thenResolve([]);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([]);

        remoteKernelFinder.activate().then(noop, noop);
        await sleep(100);
        await remoteKernelFinder.loadCache();

        await kernelsChanged.assertFiredAtLeast(1, 100).catch(noop);

        verify(cachedRemoteKernelValidator.isValid(anything())).atLeast(1);
        assert.lengthOf(kernelFinder.kernels, 0);
    });
    test('Return cached remote live kernel if used', async () => {
        const liveRemoteKernel = LiveRemoteKernelConnectionMetadata.create({
            baseUrl: 'baseUrl1',
            id: '1',
            kernelModel: {
                lastActivityTime: new Date(),
                model: {
                    id: '1',
                    name: '',
                    path: '',
                    type: '',
                    kernel: {
                        id: '1',
                        name: ''
                    }
                },
                name: '',
                numberOfConnections: 0
            },
            serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
        });
        const cachedKernels = [
            RemoteKernelSpecConnectionMetadata.create({
                baseUrl: 'baseUrl1',
                id: '2',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                },
                serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
            }).toJSON(),
            liveRemoteKernel.toJSON()
        ];
        when(cachedRemoteKernelValidator.isValid(anything())).thenCall(async (k) => liveRemoteKernel.id === k.id);
        const cacheKey = generateIdFromRemoteProvider(serverEntry.provider);
        when(fs.readFile(uriEquals(Uri.joinPath(globalStorageUri, RemoteKernelSpecCacheFileName)))).thenResolve(
            JSON.stringify(<CacheDataFormat>{ extensionVersion: '', data: { [cacheKey]: cachedKernels } })
        );
        when(jupyterSessionManager.getRunningKernels()).thenResolve([]);
        when(jupyterSessionManager.getRunningSessions()).thenResolve([]);
        when(jupyterSessionManager.getKernelSpecs()).thenResolve([]);

        remoteKernelFinder.activate().then(noop, noop);
        await remoteKernelFinder.loadCache();

        assert.lengthOf(kernelFinder.kernels, 1);
        delete (liveRemoteKernel.kernelModel as Partial<typeof liveRemoteKernel.kernelModel>).lastActivityTime;
        assert.deepEqual(
            kernelFinder.kernels.map((k) => {
                if (k.kind === 'connectToLiveRemoteKernel') {
                    delete (k.kernelModel as Partial<typeof k.kernelModel>).lastActivityTime;
                }
                return k;
            }),
            [liveRemoteKernel]
        );
    });
});
