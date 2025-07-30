// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { mock, when, instance, verify, anything } from 'ts-mockito';
import { Memento, Uri, env } from 'vscode';
import * as sinon from 'sinon';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable } from '../platform/common/types';
import { KernelPersistenceService, PersistedKernelState } from './kernelPersistenceService';
import { IKernel } from './types';
import { LocalKernelSpecConnectionMetadata } from './types';

suite('KernelPersistenceService Unit Tests', () => {
    let disposables: IDisposable[] = [];
    let persistenceService: KernelPersistenceService;
    let mockMemento: Memento;
    let mockKernel: IKernel;
    let mockConnectionMetadata: LocalKernelSpecConnectionMetadata;
    let envStub: sinon.SinonStub;

    setup(() => {
        mockMemento = mock<Memento>();
        mockKernel = mock<IKernel>();
        mockConnectionMetadata = mock<LocalKernelSpecConnectionMetadata>();

        // Setup kernel mock
        when(mockKernel.id).thenReturn('test-kernel-id');
        when(mockKernel.resourceUri).thenReturn(Uri.file('/test/notebook.ipynb'));
        when(mockKernel.kernelConnectionMetadata).thenReturn(instance(mockConnectionMetadata));
        when(mockKernel.session).thenReturn(undefined);

        // Setup connection metadata mock
        when(mockConnectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(mockConnectionMetadata.id).thenReturn('connection-id');
        when(mockConnectionMetadata.toJSON()).thenReturn({
            kind: 'startUsingLocalKernelSpec',
            id: 'connection-id',
            kernelSpec: { name: 'python3' }
        });

        // Mock VSCode env
        envStub = sinon.stub(env, 'remoteName').value(undefined);
        sinon.stub(env, 'appHost').value('desktop');

        persistenceService = new KernelPersistenceService(instance(mockMemento));
    });

    teardown(() => {
        disposables = dispose(disposables);
        sinon.restore();
    });

    suite('saveKernelState', () => {
        test('Should save kernel state to memento with correct storage key', async () => {
            // Arrange
            const resourceUri = Uri.file('/test/notebook.ipynb');
            when(mockMemento.get(anything())).thenReturn([]);
            when(mockMemento.update(anything(), anything())).thenResolve();

            // Act
            await persistenceService.saveKernelState(instance(mockKernel), resourceUri);

            // Assert
            verify(mockMemento.update(anything(), anything())).once();
        });

        test('Should create correct persisted state structure', async () => {
            // Arrange
            const resourceUri = Uri.file('/test/notebook.ipynb');
            const existingStates: PersistedKernelState[] = [];
            let capturedStates: PersistedKernelState[] = [];

            when(mockMemento.get(anything())).thenReturn(existingStates);
            when(mockMemento.update(anything(), anything())).thenCall((key, states) => {
                capturedStates = states;
                return Promise.resolve();
            });

            // Act
            await persistenceService.saveKernelState(instance(mockKernel), resourceUri);

            // Assert
            assert.equal(capturedStates.length, 1);
            const persistedState = capturedStates[0];
            assert.equal(persistedState.kernelId, 'test-kernel-id');
            assert.equal(persistedState.resourceUri, '/test/notebook.ipynb');
            assert.equal(persistedState.connectionKind, 'startUsingLocalKernelSpec');
            assert.equal(persistedState.environmentType, 'local');
            assert.isDefined(persistedState.savedAt);
        });

        test('Should update existing kernel state if kernel already persisted', async () => {
            // Arrange
            const resourceUri = Uri.file('/test/notebook.ipynb');
            const existingState: PersistedKernelState = {
                kernelId: 'test-kernel-id',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'old-id' },
                environmentType: 'local',
                savedAt: Date.now() - 1000
            };
            const existingStates = [existingState];
            let capturedStates: PersistedKernelState[] = [];

            when(mockMemento.get(anything())).thenReturn(existingStates);
            when(mockMemento.update(anything(), anything())).thenCall((key, states) => {
                capturedStates = states;
                return Promise.resolve();
            });

            // Act
            await persistenceService.saveKernelState(instance(mockKernel), resourceUri);

            // Assert
            assert.equal(capturedStates.length, 1);
            assert.equal(capturedStates[0].kernelId, 'test-kernel-id');
            assert.isTrue(capturedStates[0].savedAt > existingState.savedAt);
        });
    });

    suite('loadPersistedKernelStates', () => {
        test('Should return empty array when no states exist', async () => {
            // Arrange
            when(mockMemento.get(anything())).thenReturn(undefined);

            // Act
            const states = await persistenceService.loadPersistedKernelStates();

            // Assert
            assert.deepEqual(states, []);
        });

        test('Should return persisted states from memento', async () => {
            // Arrange
            const mockStates: PersistedKernelState[] = [
                {
                    kernelId: 'kernel-1',
                    resourceUri: '/test/notebook1.ipynb',
                    connectionKind: 'startUsingLocalKernelSpec',
                    connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                    environmentType: 'local',
                    savedAt: Date.now()
                }
            ];
            when(mockMemento.get(anything())).thenReturn(mockStates);

            // Act
            const states = await persistenceService.loadPersistedKernelStates();

            // Assert
            assert.deepEqual(states, mockStates);
        });

        test('Should filter out expired states', async () => {
            // Arrange
            const expiredTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
            const validTime = Date.now() - (1 * 60 * 60 * 1000); // 1 hour ago
            
            const mockStates: PersistedKernelState[] = [
                {
                    kernelId: 'expired-kernel',
                    resourceUri: '/test/notebook1.ipynb',
                    connectionKind: 'startUsingLocalKernelSpec',
                    connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                    environmentType: 'local',
                    savedAt: expiredTime
                },
                {
                    kernelId: 'valid-kernel',
                    resourceUri: '/test/notebook2.ipynb',
                    connectionKind: 'startUsingLocalKernelSpec',
                    connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-2' },
                    environmentType: 'local',
                    savedAt: validTime
                }
            ];
            when(mockMemento.get(anything())).thenReturn(mockStates);

            // Act
            const states = await persistenceService.loadPersistedKernelStates();

            // Assert
            assert.equal(states.length, 1);
            assert.equal(states[0].kernelId, 'valid-kernel');
        });
    });

    suite('removeKernelState', () => {
        test('Should remove kernel state by id', async () => {
            // Arrange
            const mockStates: PersistedKernelState[] = [
                {
                    kernelId: 'kernel-1',
                    resourceUri: '/test/notebook1.ipynb',
                    connectionKind: 'startUsingLocalKernelSpec',
                    connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                    environmentType: 'local',
                    savedAt: Date.now()
                },
                {
                    kernelId: 'kernel-2',
                    resourceUri: '/test/notebook2.ipynb',
                    connectionKind: 'startUsingLocalKernelSpec',
                    connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-2' },
                    environmentType: 'local',
                    savedAt: Date.now()
                }
            ];
            let capturedStates: PersistedKernelState[] = [];

            when(mockMemento.get(anything())).thenReturn(mockStates);
            when(mockMemento.update(anything(), anything())).thenCall((key, states) => {
                capturedStates = states;
                return Promise.resolve();
            });

            // Act
            await persistenceService.removeKernelState('kernel-1');

            // Assert
            assert.equal(capturedStates.length, 1);
            assert.equal(capturedStates[0].kernelId, 'kernel-2');
        });

        test('Should handle removal of non-existent kernel gracefully', async () => {
            // Arrange
            const mockStates: PersistedKernelState[] = [];
            when(mockMemento.get(anything())).thenReturn(mockStates);
            when(mockMemento.update(anything(), anything())).thenResolve();

            // Act & Assert - should not throw
            await persistenceService.removeKernelState('non-existent-kernel');
            verify(mockMemento.update(anything(), anything())).once();
        });
    });

    suite('clearExpiredStates', () => {
        test('Should remove expired states and keep valid ones', async () => {
            // Arrange
            const expiredTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
            const validTime = Date.now() - (1 * 60 * 60 * 1000); // 1 hour ago
            
            const mockStates: PersistedKernelState[] = [
                {
                    kernelId: 'expired-kernel',
                    resourceUri: '/test/notebook1.ipynb',
                    connectionKind: 'startUsingLocalKernelSpec',
                    connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                    environmentType: 'local',
                    savedAt: expiredTime
                },
                {
                    kernelId: 'valid-kernel',
                    resourceUri: '/test/notebook2.ipynb',
                    connectionKind: 'startUsingLocalKernelSpec',
                    connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-2' },
                    environmentType: 'local',
                    savedAt: validTime
                }
            ];
            let capturedStates: PersistedKernelState[] = [];

            when(mockMemento.get(anything())).thenReturn(mockStates);
            when(mockMemento.update(anything(), anything())).thenCall((key, states) => {
                capturedStates = states;
                return Promise.resolve();
            });

            // Act
            const removedCount = await persistenceService.clearExpiredStates();

            // Assert
            assert.equal(removedCount, 1);
            assert.equal(capturedStates.length, 1);
            assert.equal(capturedStates[0].kernelId, 'valid-kernel');
        });
    });

    suite('Environment-aware storage', () => {
        test('Should use different storage keys for different environments', async () => {
            // Arrange
            const resourceUri = Uri.file('/test/notebook.ipynb');
            let capturedKeys: string[] = [];

            when(mockMemento.get(anything())).thenCall((key) => {
                capturedKeys.push(key);
                return [];
            });
            when(mockMemento.update(anything(), anything())).thenResolve();

            // Test local environment
            await persistenceService.saveKernelState(instance(mockKernel), resourceUri);
            const localKey = capturedKeys[0];

            // Test SSH environment
            envStub.value('ssh-remote-test');
            const sshService = new KernelPersistenceService(instance(mockMemento));
            capturedKeys = [];
            await sshService.saveKernelState(instance(mockKernel), resourceUri);
            const sshKey = capturedKeys[0];

            // Assert
            assert.notEqual(localKey, sshKey);
            assert.include(localKey, 'local');
            assert.include(sshKey, 'ssh');
        });
    });
});