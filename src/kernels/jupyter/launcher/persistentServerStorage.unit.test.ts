// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { anything, instance, mock, when, verify, reset } from 'ts-mockito';
import { Disposable, Memento } from 'vscode';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposableRegistry } from '../../../platform/common/types';
import { PersistentServerStorage, IPersistentServerInfo } from './persistentServerStorage';

suite('Persistent Server Storage', () => {
    let storage: PersistentServerStorage;
    let globalMemento: Memento;
    let disposableRegistry: IDisposableRegistry;
    let disposables: Disposable[] = [];

    setup(() => {
        globalMemento = mock<Memento>();
        disposableRegistry = mock<IDisposableRegistry>();
        
        // Mock the memento to return empty array initially
        when(globalMemento.get(anything(), anything())).thenReturn([]);
        when(globalMemento.update(anything(), anything())).thenResolve();
        when(disposableRegistry.push(anything())).thenReturn();

        storage = new PersistentServerStorage(
            instance(globalMemento),
            instance(disposableRegistry)
        );
        disposables.push(storage);
    });

    teardown(() => {
        disposables = dispose(disposables);
        reset(globalMemento);
        reset(disposableRegistry);
    });

    test('Should initialize with empty server list', () => {
        const servers = storage.all;
        expect(servers).to.be.an('array').that.is.empty;
    });

    test('Should add server and fire events', async () => {
        const serverInfo: IPersistentServerInfo = {
            serverId: 'test-server-1',
            displayName: 'Test Server',
            url: 'http://localhost:8888/?token=abc123',
            token: 'abc123',
            workingDirectory: '/path/to/workspace',
            launchedByExtension: true,
            time: Date.now()
        };

        let addEventFired = false;
        let changeEventFired = false;

        storage.onDidAdd(() => { addEventFired = true; });
        storage.onDidChange(() => { changeEventFired = true; });

        await storage.add(serverInfo);

        expect(addEventFired).to.be.true;
        expect(changeEventFired).to.be.true;
        expect(storage.all).to.have.lengthOf(1);
        expect(storage.all[0].serverId).to.equal('test-server-1');
        verify(globalMemento.update(anything(), anything())).once();
    });

    test('Should update existing server', async () => {
        const serverInfo: IPersistentServerInfo = {
            serverId: 'test-server-1',
            displayName: 'Test Server',
            url: 'http://localhost:8888/?token=abc123',
            token: 'abc123',
            workingDirectory: '/path/to/workspace',
            launchedByExtension: true,
            time: Date.now()
        };

        await storage.add(serverInfo);
        
        let changeEventFired = false;
        storage.onDidChange(() => { changeEventFired = true; });

        await storage.update('test-server-1', { displayName: 'Updated Server' });

        expect(changeEventFired).to.be.true;
        expect(storage.get('test-server-1')?.displayName).to.equal('Updated Server');
    });

    test('Should remove server and fire events', async () => {
        const serverInfo: IPersistentServerInfo = {
            serverId: 'test-server-1',
            displayName: 'Test Server',
            url: 'http://localhost:8888/?token=abc123',
            token: 'abc123',
            workingDirectory: '/path/to/workspace',
            launchedByExtension: true,
            time: Date.now()
        };

        await storage.add(serverInfo);
        expect(storage.all).to.have.lengthOf(1);

        let removeEventFired = false;
        let changeEventFired = false;

        storage.onDidRemove((serverId) => { 
            removeEventFired = true;
            expect(serverId).to.equal('test-server-1');
        });
        storage.onDidChange(() => { changeEventFired = true; });

        await storage.remove('test-server-1');

        expect(removeEventFired).to.be.true;
        expect(changeEventFired).to.be.true;
        expect(storage.all).to.have.lengthOf(0);
    });

    test('Should get server by ID', async () => {
        const serverInfo: IPersistentServerInfo = {
            serverId: 'test-server-1',
            displayName: 'Test Server',
            url: 'http://localhost:8888/?token=abc123',
            token: 'abc123',
            workingDirectory: '/path/to/workspace',
            launchedByExtension: true,
            time: Date.now()
        };

        await storage.add(serverInfo);

        const retrieved = storage.get('test-server-1');
        expect(retrieved).to.not.be.undefined;
        expect(retrieved?.serverId).to.equal('test-server-1');
        expect(retrieved?.displayName).to.equal('Test Server');

        const notFound = storage.get('non-existent');
        expect(notFound).to.be.undefined;
    });

    test('Should clear all servers', async () => {
        const serverInfo1: IPersistentServerInfo = {
            serverId: 'test-server-1',
            displayName: 'Test Server 1',
            url: 'http://localhost:8888/?token=abc123',
            token: 'abc123',
            workingDirectory: '/path/to/workspace1',
            launchedByExtension: true,
            time: Date.now()
        };

        const serverInfo2: IPersistentServerInfo = {
            serverId: 'test-server-2',
            displayName: 'Test Server 2',
            url: 'http://localhost:8889/?token=def456',
            token: 'def456',
            workingDirectory: '/path/to/workspace2',
            launchedByExtension: true,
            time: Date.now()
        };

        await storage.add(serverInfo1);
        await storage.add(serverInfo2);
        expect(storage.all).to.have.lengthOf(2);

        const removedServers: string[] = [];
        storage.onDidRemove((serverId) => { removedServers.push(serverId); });

        await storage.clear();

        expect(storage.all).to.have.lengthOf(0);
        expect(removedServers).to.have.lengthOf(2);
        expect(removedServers).to.include('test-server-1');
        expect(removedServers).to.include('test-server-2');
    });

    test('Should handle invalid stored data gracefully', () => {
        // Reset and create storage with invalid data
        disposables = dispose(disposables);
        
        const invalidData = [
            { serverId: 'valid-server', url: 'http://localhost:8888', workingDirectory: '/path' },
            { serverId: '', url: 'http://localhost:8889', workingDirectory: '/path' }, // Invalid: empty serverId
            { serverId: 'missing-url', workingDirectory: '/path' }, // Invalid: missing url
            { serverId: 'missing-dir', url: 'http://localhost:8890' } // Invalid: missing workingDirectory
        ];

        when(globalMemento.get(anything(), anything())).thenReturn(invalidData);

        storage = new PersistentServerStorage(
            instance(globalMemento),
            instance(disposableRegistry)
        );
        disposables.push(storage);

        // Only valid server should be loaded
        expect(storage.all).to.have.lengthOf(1);
        expect(storage.all[0].serverId).to.equal('valid-server');
    });

    test('Should preserve order with most recent first', async () => {
        const serverInfo1: IPersistentServerInfo = {
            serverId: 'test-server-1',
            displayName: 'Test Server 1',
            url: 'http://localhost:8888/?token=abc123',
            token: 'abc123',
            workingDirectory: '/path/to/workspace1',
            launchedByExtension: true,
            time: 1000
        };

        const serverInfo2: IPersistentServerInfo = {
            serverId: 'test-server-2',
            displayName: 'Test Server 2',
            url: 'http://localhost:8889/?token=def456',
            token: 'def456',
            workingDirectory: '/path/to/workspace2',
            launchedByExtension: true,
            time: 2000
        };

        await storage.add(serverInfo1);
        await storage.add(serverInfo2);

        const servers = storage.all;
        expect(servers[0].serverId).to.equal('test-server-2'); // Most recent first
        expect(servers[1].serverId).to.equal('test-server-1');
    });

    test('Should replace existing server with same ID', async () => {
        const serverInfo: IPersistentServerInfo = {
            serverId: 'test-server-1',
            displayName: 'Test Server',
            url: 'http://localhost:8888/?token=abc123',
            token: 'abc123',
            workingDirectory: '/path/to/workspace',
            launchedByExtension: true,
            time: Date.now()
        };

        await storage.add(serverInfo);
        expect(storage.all).to.have.lengthOf(1);

        const updatedServerInfo: IPersistentServerInfo = {
            ...serverInfo,
            displayName: 'Updated Test Server',
            url: 'http://localhost:8889/?token=xyz789',
            token: 'xyz789'
        };

        await storage.add(updatedServerInfo);
        
        // Should still have only one server, but with updated info
        expect(storage.all).to.have.lengthOf(1);
        expect(storage.all[0].displayName).to.equal('Updated Test Server');
        expect(storage.all[0].token).to.equal('xyz789');
    });
});