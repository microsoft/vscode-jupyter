// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { mock, when, instance, verify, anything } from 'ts-mockito';
import { CancellationToken, CancellationTokenSource, Uri, env } from 'vscode';
import * as sinon from 'sinon';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable } from '../platform/common/types';
import { KernelConnectionRestorer } from './kernelConnectionRestorer';
import { IKernelProcessDiscovery, KernelConnectionInfo } from './kernelProcessDiscovery.node';
import { IKernelSessionFactory, IKernelSession } from './types';
import { PersistedKernelState } from './kernelPersistenceService';
import { LocalKernelSpecConnectionMetadata, LiveRemoteKernelConnectionMetadata } from './types';

suite('KernelConnectionRestorer Unit Tests', () => {
    let disposables: IDisposable[] = [];
    let connectionRestorer: KernelConnectionRestorer;
    let mockProcessDiscovery: IKernelProcessDiscovery;
    let mockSessionFactory: IKernelSessionFactory;
    let mockSession: IKernelSession;
    let mockConnectionMetadata: LocalKernelSpecConnectionMetadata;
    let mockRemoteConnectionMetadata: LiveRemoteKernelConnectionMetadata;
    let envStub: sinon.SinonStub;
    let token: CancellationToken;

    setup(() => {
        mockProcessDiscovery = mock<IKernelProcessDiscovery>();
        mockSessionFactory = mock<IKernelSessionFactory>();
        mockSession = mock<IKernelSession>();
        mockConnectionMetadata = mock<LocalKernelSpecConnectionMetadata>();
        mockRemoteConnectionMetadata = mock<LiveRemoteKernelConnectionMetadata>();

        // Setup session mock
        when(mockSession.isDisposed).thenReturn(false);
        when(mockSession.status).thenReturn('idle');
        when(mockSession.kernel).thenReturn({
            requestKernelInfo: () => ({
                done: Promise.resolve({ content: { protocol_version: '5.3' } })
            })
        } as any);

        // Setup connection metadata mocks
        when(mockConnectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(mockConnectionMetadata.id).thenReturn('local-connection-id');

        when(mockRemoteConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');
        when(mockRemoteConnectionMetadata.id).thenReturn('remote-connection-id');
        when(mockRemoteConnectionMetadata.baseUrl).thenReturn('http://localhost:8888');
        when(mockRemoteConnectionMetadata.serverProviderHandle).thenReturn({
            id: 'test-provider',
            handle: 'test-handle',
            extensionId: 'test-extension'
        });

        // Mock VSCode env
        envStub = sinon.stub(env, 'remoteName').value(undefined);
        sinon.stub(env, 'appHost').value('desktop');

        token = new CancellationTokenSource().token;

        connectionRestorer = new KernelConnectionRestorer(
            instance(mockProcessDiscovery),
            instance(mockSessionFactory)
        );
    });

    teardown(() => {
        disposables = dispose(disposables);
        sinon.restore();
    });

    suite('restoreConnection', () => {
        test('Should restore local connection successfully', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: {
                    kind: 'startUsingLocalKernelSpec',
                    id: 'local-connection-id',
                    kernelSpec: { name: 'python3' }
                },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345,
                sessionId: 'session-123'
            };

            const connectionInfo: KernelConnectionInfo = {
                processId: 12345,
                connectionFile: '/tmp/kernel-12345.json',
                connectionData: {
                    ip: '127.0.0.1',
                    transport: 'tcp',
                    shell_port: 12345,
                    iopub_port: 12346,
                    stdin_port: 12347,
                    control_port: 12348,
                    hb_port: 12349,
                    signature_scheme: 'hmac-sha256',
                    key: 'test-key'
                }
            };

            // Mock process discovery
            when(mockProcessDiscovery.isKernelProcessRunning(persistedState)).thenResolve(true);
            when(mockProcessDiscovery.getKernelConnectionInfo(12345)).thenResolve(connectionInfo);

            // Mock session factory
            when(mockSessionFactory.create(anything())).thenResolve(instance(mockSession));

            // Act
            const restoredSession = await connectionRestorer.restoreConnection(persistedState, token);

            // Assert
            assert.isDefined(restoredSession);
            verify(mockProcessDiscovery.isKernelProcessRunning(persistedState)).once();
            verify(mockProcessDiscovery.getKernelConnectionInfo(12345)).once();
            verify(mockSessionFactory.create(anything())).once();
        });

        test('Should return undefined when local process is not running', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: {
                    kind: 'startUsingLocalKernelSpec',
                    id: 'local-connection-id'
                },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            // Mock process not running
            when(mockProcessDiscovery.isKernelProcessRunning(persistedState)).thenResolve(false);

            // Act
            const restoredSession = await connectionRestorer.restoreConnection(persistedState, token);

            // Assert
            assert.isUndefined(restoredSession);
            verify(mockProcessDiscovery.getKernelConnectionInfo(anything())).never();
        });

        test('Should restore remote connection successfully', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'connectToLiveRemoteKernel',
                connectionMetadata: {
                    kind: 'connectToLiveRemoteKernel',
                    id: 'remote-connection-id',
                    baseUrl: 'http://localhost:8888',
                    serverProviderHandle: {
                        id: 'test-provider',
                        handle: 'test-handle',
                        extensionId: 'test-extension'
                    }
                },
                environmentType: 'local',
                savedAt: Date.now(),
                sessionId: 'remote-session-123'
            };

            // Mock session factory
            when(mockSessionFactory.create(anything())).thenResolve(instance(mockSession));

            // Act
            const restoredSession = await connectionRestorer.restoreConnection(persistedState, token);

            // Assert
            assert.isDefined(restoredSession);
            verify(mockSessionFactory.create(anything())).once();
        });

        test('Should return undefined for unsupported connection kind', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'unsupportedKind' as any,
                connectionMetadata: {
                    kind: 'unsupportedKind' as any,
                    id: 'test-id'
                },
                environmentType: 'local',
                savedAt: Date.now()
            };

            // Act
            const restoredSession = await connectionRestorer.restoreConnection(persistedState, token);

            // Assert
            assert.isUndefined(restoredSession);
        });

        test('Should handle errors gracefully', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: {
                    kind: 'startUsingLocalKernelSpec',
                    id: 'local-connection-id'
                },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            // Mock process discovery error
            when(mockProcessDiscovery.isKernelProcessRunning(persistedState)).thenReject(new Error('Discovery failed'));

            // Act
            const restoredSession = await connectionRestorer.restoreConnection(persistedState, token);

            // Assert
            assert.isUndefined(restoredSession);
        });
    });

    suite('validateConnection', () => {
        test('Should return true for valid connection', async () => {
            // Arrange
            when(mockSession.isDisposed).thenReturn(false);
            when(mockSession.status).thenReturn('idle');
            when(mockSession.kernel).thenReturn({
                requestKernelInfo: () => ({
                    done: Promise.resolve({ content: { protocol_version: '5.3' } })
                })
            } as any);

            // Act
            const isValid = await connectionRestorer.validateConnection(instance(mockSession));

            // Assert
            assert.isTrue(isValid);
        });

        test('Should return false for disposed session', async () => {
            // Arrange
            when(mockSession.isDisposed).thenReturn(true);

            // Act
            const isValid = await connectionRestorer.validateConnection(instance(mockSession));

            // Assert
            assert.isFalse(isValid);
        });

        test('Should return false for dead session', async () => {
            // Arrange
            when(mockSession.isDisposed).thenReturn(false);
            when(mockSession.status).thenReturn('dead');

            // Act
            const isValid = await connectionRestorer.validateConnection(instance(mockSession));

            // Assert
            assert.isFalse(isValid);
        });

        test('Should return false when kernel info request fails', async () => {
            // Arrange
            when(mockSession.isDisposed).thenReturn(false);
            when(mockSession.status).thenReturn('idle');
            when(mockSession.kernel).thenReturn({
                requestKernelInfo: () => ({
                    done: Promise.reject(new Error('Request failed'))
                })
            } as any);

            // Act
            const isValid = await connectionRestorer.validateConnection(instance(mockSession));

            // Assert
            assert.isFalse(isValid);
        });

        test('Should timeout validation after 5 seconds', async () => {
            // Arrange
            when(mockSession.isDisposed).thenReturn(false);
            when(mockSession.status).thenReturn('idle');
            when(mockSession.kernel).thenReturn({
                requestKernelInfo: () => ({
                    done: new Promise(() => {}) // Never resolves
                })
            } as any);

            // Act
            const startTime = Date.now();
            const isValid = await connectionRestorer.validateConnection(instance(mockSession));
            const endTime = Date.now();

            // Assert
            assert.isFalse(isValid);
            assert.isTrue(endTime - startTime >= 5000);
            assert.isTrue(endTime - startTime < 6000); // Allow some margin
        });
    });

    suite('canRestore', () => {
        test('Should return true for valid local kernel in same environment', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: {
                    kind: 'startUsingLocalKernelSpec',
                    id: 'local-connection-id'
                },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            when(mockProcessDiscovery.isKernelProcessRunning(persistedState)).thenResolve(true);

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert
            assert.isTrue(canRestore);
        });

        test('Should return false for kernel from different environment', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: {
                    kind: 'startUsingLocalKernelSpec',
                    id: 'local-connection-id'
                },
                environmentType: 'ssh',
                remoteName: 'ssh-remote-host',
                savedAt: Date.now(),
                processId: 12345
            };

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert
            assert.isFalse(canRestore);
        });

        test('Should return false when local process is not running', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: {
                    kind: 'startUsingLocalKernelSpec',
                    id: 'local-connection-id'
                },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            when(mockProcessDiscovery.isKernelProcessRunning(persistedState)).thenResolve(false);

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert
            assert.isFalse(canRestore);
        });

        test('Should return true for remote kernels optimistically', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'connectToLiveRemoteKernel',
                connectionMetadata: {
                    kind: 'connectToLiveRemoteKernel',
                    id: 'remote-connection-id'
                },
                environmentType: 'local',
                savedAt: Date.now(),
                sessionId: 'remote-session-123'
            };

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert
            assert.isTrue(canRestore);
        });

        test('Should handle errors gracefully', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: {
                    kind: 'startUsingLocalKernelSpec',
                    id: 'local-connection-id'
                },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            when(mockProcessDiscovery.isKernelProcessRunning(persistedState)).thenReject(new Error('Check failed'));

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert
            assert.isFalse(canRestore);
        });
    });

    suite('Environment detection', () => {
        test('Should detect local environment correctly', async () => {
            // Arrange - env.remoteName is already undefined from setup
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'local-id' },
                environmentType: 'local',
                savedAt: Date.now()
            };

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert - Should be able to restore (environment matches)
            assert.isTrue(canRestore);
        });

        test('Should detect SSH environment correctly', async () => {
            // Arrange
            envStub.value('ssh-remote-test');
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'ssh-id' },
                environmentType: 'ssh',
                remoteName: 'ssh-remote-test',
                savedAt: Date.now()
            };

            when(mockProcessDiscovery.isKernelProcessRunning(persistedState)).thenResolve(true);

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert
            assert.isTrue(canRestore);
        });

        test('Should detect container environment correctly', async () => {
            // Arrange
            envStub.value('dev-container-test');
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'connectToLiveRemoteKernel',
                connectionMetadata: { kind: 'connectToLiveRemoteKernel', id: 'container-id' },
                environmentType: 'container',
                remoteName: 'dev-container-test',
                savedAt: Date.now()
            };

            // Act
            const canRestore = await connectionRestorer.canRestore(persistedState);

            // Assert
            assert.isTrue(canRestore);
        });
    });
});