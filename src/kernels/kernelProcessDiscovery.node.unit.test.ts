// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { mock, when, instance, verify, anything } from 'ts-mockito';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs-extra';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable } from '../platform/common/types';
import { KernelProcessDiscovery, KernelConnectionInfo } from './kernelProcessDiscovery.node';
import { PersistedKernelState } from './kernelPersistenceService';

suite('KernelProcessDiscovery Unit Tests', () => {
    let disposables: IDisposable[] = [];
    let processDiscovery: KernelProcessDiscovery;
    let execStub: sinon.SinonStub;
    let fsStub: sinon.SinonStub;
    let existsStub: sinon.SinonStub;
    let readJsonStub: sinon.SinonStub;

    setup(() => {
        processDiscovery = new KernelProcessDiscovery();
        
        // Stub child_process.exec
        execStub = sinon.stub(require('child_process'), 'exec');
        
        // Stub fs operations
        fsStub = sinon.stub(fs, 'readdir');
        existsStub = sinon.stub(fs, 'pathExists');
        readJsonStub = sinon.stub(fs, 'readJson');
    });

    teardown(() => {
        disposables = dispose(disposables);
        sinon.restore();
    });

    suite('isKernelProcessRunning', () => {
        test('Should return true when process exists on Unix', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            // Mock successful ps command
            execStub.callsArgWith(1, null, '12345 python -m ipykernel_launcher', '');

            // Act
            const isRunning = await processDiscovery.isKernelProcessRunning(persistedState);

            // Assert
            assert.isTrue(isRunning);
            assert.isTrue(execStub.calledOnce);
        });

        test('Should return false when process does not exist on Unix', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            // Mock ps command with no results
            execStub.callsArgWith(1, null, '', '');

            // Act
            const isRunning = await processDiscovery.isKernelProcessRunning(persistedState);

            // Assert
            assert.isFalse(isRunning);
        });

        test('Should return true when process exists on Windows', async () => {
            // Arrange
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32' });

            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            // Mock successful tasklist command
            execStub.callsArgWith(1, null, 'python.exe                  12345 Console', '');

            // Act
            const isRunning = await processDiscovery.isKernelProcessRunning(persistedState);

            // Assert
            assert.isTrue(isRunning);

            // Cleanup
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });

        test('Should return false when no processId is provided', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                environmentType: 'local',
                savedAt: Date.now()
                // No processId
            };

            // Act
            const isRunning = await processDiscovery.isKernelProcessRunning(persistedState);

            // Assert
            assert.isFalse(isRunning);
            assert.isFalse(execStub.called);
        });

        test('Should handle command execution errors gracefully', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            // Mock command error
            execStub.callsArgWith(1, new Error('Command failed'), '', 'Error');

            // Act
            const isRunning = await processDiscovery.isKernelProcessRunning(persistedState);

            // Assert
            assert.isFalse(isRunning);
        });
    });

    suite('getKernelConnectionInfo', () => {
        test('Should return connection info when connection file exists', async () => {
            // Arrange
            const processId = 12345;
            const runtimeDir = '/tmp/runtime';
            const connectionFile = path.join(runtimeDir, `kernel-${processId}.json`);
            const connectionData = {
                ip: '127.0.0.1',
                transport: 'tcp',
                shell_port: 12345,
                iopub_port: 12346,
                stdin_port: 12347,
                control_port: 12348,
                hb_port: 12349,
                signature_scheme: 'hmac-sha256',
                key: 'test-key'
            };

            // Mock runtime directory discovery
            fsStub.resolves(['kernel-12345.json', 'other-file.txt']);
            existsStub.withArgs(sinon.match.string).resolves(true);
            readJsonStub.withArgs(connectionFile).resolves(connectionData);

            // Act
            const connectionInfo = await processDiscovery.getKernelConnectionInfo(processId);

            // Assert
            assert.isDefined(connectionInfo);
            assert.equal(connectionInfo!.connectionFile, connectionFile);
            assert.deepEqual(connectionInfo!.connectionData, connectionData);
        });

        test('Should return undefined when connection file does not exist', async () => {
            // Arrange
            const processId = 12345;

            // Mock no connection file found
            fsStub.resolves(['other-file.txt']);
            existsStub.resolves(false);

            // Act
            const connectionInfo = await processDiscovery.getKernelConnectionInfo(processId);

            // Assert
            assert.isUndefined(connectionInfo);
        });

        test('Should handle file read errors gracefully', async () => {
            // Arrange
            const processId = 12345;
            const runtimeDir = '/tmp/runtime';
            const connectionFile = path.join(runtimeDir, `kernel-${processId}.json`);

            // Mock file exists but read fails
            fsStub.resolves(['kernel-12345.json']);
            existsStub.withArgs(sinon.match.string).resolves(true);
            readJsonStub.withArgs(connectionFile).rejects(new Error('Read failed'));

            // Act
            const connectionInfo = await processDiscovery.getKernelConnectionInfo(processId);

            // Assert
            assert.isUndefined(connectionInfo);
        });
    });

    suite('findRunningKernels', () => {
        test('Should find running kernels with connection files', async () => {
            // Arrange
            const kernelFiles = ['kernel-12345.json', 'kernel-67890.json'];
            const connectionData = {
                ip: '127.0.0.1',
                transport: 'tcp',
                shell_port: 12345,
                iopub_port: 12346,
                stdin_port: 12347,
                control_port: 12348,
                hb_port: 12349,
                signature_scheme: 'hmac-sha256',
                key: 'test-key'
            };

            // Mock process discovery
            execStub.callsArgWith(1, null, '12345 python -m ipykernel_launcher\n67890 python -m ipykernel_launcher', '');
            
            // Mock file system operations
            fsStub.resolves(kernelFiles);
            existsStub.resolves(true);
            readJsonStub.resolves(connectionData);

            // Act
            const runningKernels = await processDiscovery.findRunningKernels();

            // Assert
            assert.equal(runningKernels.length, 2);
            assert.equal(runningKernels[0].processId, 12345);
            assert.equal(runningKernels[1].processId, 67890);
            assert.isDefined(runningKernels[0].connectionFile);
            assert.isDefined(runningKernels[1].connectionFile);
        });

        test('Should return empty array when no kernels are running', async () => {
            // Arrange
            execStub.callsArgWith(1, null, '', '');

            // Act
            const runningKernels = await processDiscovery.findRunningKernels();

            // Assert
            assert.deepEqual(runningKernels, []);
        });

        test('Should handle process discovery errors gracefully', async () => {
            // Arrange
            execStub.callsArgWith(1, new Error('Process discovery failed'), '', 'Error');

            // Act
            const runningKernels = await processDiscovery.findRunningKernels();

            // Assert
            assert.deepEqual(runningKernels, []);
        });
    });

    suite('Platform-specific behavior', () => {
        test('Should use correct process discovery command on Windows', async () => {
            // Arrange
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32' });

            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            execStub.callsArgWith(1, null, 'python.exe                  12345 Console', '');

            // Act
            await processDiscovery.isKernelProcessRunning(persistedState);

            // Assert
            assert.isTrue(execStub.calledWith(sinon.match(/tasklist/)));

            // Cleanup
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });

        test('Should use correct process discovery command on Unix', async () => {
            // Arrange
            const persistedState: PersistedKernelState = {
                kernelId: 'test-kernel',
                resourceUri: '/test/notebook.ipynb',
                connectionKind: 'startUsingLocalKernelSpec',
                connectionMetadata: { kind: 'startUsingLocalKernelSpec', id: 'conn-1' },
                environmentType: 'local',
                savedAt: Date.now(),
                processId: 12345
            };

            execStub.callsArgWith(1, null, '12345 python -m ipykernel_launcher', '');

            // Act
            await processDiscovery.isKernelProcessRunning(persistedState);

            // Assert
            assert.isTrue(execStub.calledWith(sinon.match(/ps aux/)));
        });
    });
});