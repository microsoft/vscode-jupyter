// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { anything, instance, mock, when, verify, reset } from 'ts-mockito';
import { Disposable, Uri } from 'vscode';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { PersistentServerManager } from './persistentServerManager.node';
import { IPersistentServerStorage, IPersistentServerInfo } from './persistentServerStorage';
import { PersistentJupyterServerProvider } from './persistentJupyterServerProvider.node';

// Test class that allows us to mock the health check
class TestPersistentServerManager extends PersistentServerManager {
    public healthCheckResults = new Map<string, boolean>();

    protected override async checkServerHealth(server: IPersistentServerInfo): Promise<boolean> {
        return this.healthCheckResults.get(server.serverId) ?? true; // Default to healthy
    }
}

suite('Persistent Server Manager', () => {
    let serverManager: TestPersistentServerManager;
    let persistentServerStorage: IPersistentServerStorage;
    let serverProvider: PersistentJupyterServerProvider;

    let disposables: Disposable[] = [];

    const mockServer1: IPersistentServerInfo = {
        serverId: 'server-1',
        displayName: 'Test Server 1',
        url: 'http://localhost:8888/?token=token1',
        token: 'token1',
        workingDirectory: '/workspace1',
        launchedByExtension: true,
        time: Date.now() - 1000 // 1 second ago
    };

    const mockServer2: IPersistentServerInfo = {
        serverId: 'server-2',
        displayName: 'Test Server 2',
        url: 'http://localhost:8889/?token=token2',
        token: 'token2',
        workingDirectory: '/workspace2',
        launchedByExtension: true,
        time: Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 days ago (should be cleaned up)
    };

    const mockServer3: IPersistentServerInfo = {
        serverId: 'server-3',
        displayName: 'External Server',
        url: 'http://localhost:8890/?token=token3',
        token: 'token3',
        workingDirectory: '/workspace3',
        launchedByExtension: false, // Not launched by extension
        time: Date.now() - 10 * 24 * 60 * 60 * 1000 // 10 days ago
    };

    setup(() => {
        persistentServerStorage = mock<IPersistentServerStorage>();
        serverProvider = mock<PersistentJupyterServerProvider>();

        when(persistentServerStorage.all).thenReturn([mockServer1, mockServer2, mockServer3]);
        when(persistentServerStorage.get('server-1')).thenReturn(mockServer1);
        when(persistentServerStorage.get('server-2')).thenReturn(mockServer2);
        when(persistentServerStorage.get('server-3')).thenReturn(mockServer3);
        when(persistentServerStorage.get('non-existent')).thenReturn(undefined);
        when(persistentServerStorage.remove(anything())).thenResolve();

        when(serverProvider.getAllPersistentServers()).thenReturn([mockServer1, mockServer2]);
        when(serverProvider.stopPersistentServer(anything())).thenResolve();

        serverManager = new TestPersistentServerManager(
            instance(persistentServerStorage),
            instance(serverProvider)
        );

        disposables.push(serverManager);
    });

    teardown(() => {
        disposables = dispose(disposables);
        reset(persistentServerStorage);
        reset(serverProvider);
        serverManager?.healthCheckResults.clear();
    });

    test('Should get all servers from provider', () => {
        const servers = serverManager.getAllServers();

        expect(servers).to.have.lengthOf(2);
        expect(servers[0].serverId).to.equal('server-1');
        expect(servers[1].serverId).to.equal('server-2');

        verify(serverProvider.getAllPersistentServers()).once();
    });

    test('Should stop server by ID', async () => {
        await serverManager.stopServer('server-1');

        verify(serverProvider.stopPersistentServer('server-1')).once();
    });

    test('Should handle stopping non-existent server gracefully', async () => {
        await serverManager.stopServer('non-existent');

        // Should not throw and should not call stop on provider
        verify(serverProvider.stopPersistentServer('non-existent')).never();
    });

    test('Should find server for workspace', () => {
        const workspace1 = Uri.file('/workspace1');
        const workspace2 = Uri.file('/workspace2');
        const workspace3 = Uri.file('/workspace3');
        const nonExistentWorkspace = Uri.file('/non-existent');

        const server1 = serverManager.getServerForWorkspace(workspace1);
        const server2 = serverManager.getServerForWorkspace(workspace2);
        const server3 = serverManager.getServerForWorkspace(workspace3);
        const noServer = serverManager.getServerForWorkspace(nonExistentWorkspace);

        expect(server1?.serverId).to.equal('server-1');
        expect(server2?.serverId).to.equal('server-2');
        expect(server3).to.be.undefined; // Not launched by extension
        expect(noServer).to.be.undefined;
    });

    test('Should cleanup old servers', async () => {
        // Set up health check results - server-1 should be healthy (and too recent to health check anyway)
        serverManager.healthCheckResults.set('server-1', true);
        serverManager.healthCheckResults.set('server-2', true); // server-2 will be cleaned up due to age, not health

        await serverManager.cleanupServers();

        // Should remove server-2 (8 days old) but not server-3 (not launched by extension) or server-1 (recent)
        verify(persistentServerStorage.remove('server-2')).once();
        verify(persistentServerStorage.remove('server-1')).never();
        verify(persistentServerStorage.remove('server-3')).never();
    });

    test('Should not cleanup recent servers', async () => {
        // Mock all servers as recent
        const recentServer1 = { ...mockServer1, time: Date.now() - 1000 };
        const recentServer2 = { ...mockServer2, time: Date.now() - 1000 };
        when(persistentServerStorage.all).thenReturn([recentServer1, recentServer2]);

        // Set up health check results (but they shouldn't be called since servers are too recent)
        serverManager.healthCheckResults.set('server-1', true);
        serverManager.healthCheckResults.set('server-2', true);

        await serverManager.cleanupServers();

        // Should not remove any servers
        verify(persistentServerStorage.remove(anything())).never();
    });

    test('Should handle cleanup with no servers', async () => {
        when(persistentServerStorage.all).thenReturn([]);

        await serverManager.cleanupServers();

        // Should not throw and should not try to remove anything
        verify(persistentServerStorage.remove(anything())).never();
    });

    test('Should handle cleanup with only external servers', async () => {
        const externalServer = { ...mockServer3 };
        when(persistentServerStorage.all).thenReturn([externalServer]);

        await serverManager.cleanupServers();

        // Should not remove external servers even if old
        verify(persistentServerStorage.remove(anything())).never();
    });

    test('Should cleanup very old servers launched by extension', async () => {
        const veryOldServer: IPersistentServerInfo = {
            serverId: 'very-old-server',
            displayName: 'Very Old Server',
            url: 'http://localhost:8891',
            token: 'old-token',
            workingDirectory: '/old-workspace',
            launchedByExtension: true,
            time: Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago
        };

        when(persistentServerStorage.all).thenReturn([veryOldServer]);

        await serverManager.cleanupServers();

        verify(persistentServerStorage.remove('very-old-server')).once();
    });

    test('Should handle mixed age servers correctly', async () => {
        const recentServer: IPersistentServerInfo = {
            serverId: 'recent-server',
            displayName: 'Recent Server',
            url: 'http://localhost:8892',
            token: 'recent-token',
            workingDirectory: '/recent-workspace',
            launchedByExtension: true,
            time: Date.now() - 1000 // 1 second ago
        };

        const oldServer: IPersistentServerInfo = {
            serverId: 'old-server',
            displayName: 'Old Server',
            url: 'http://localhost:8893',
            token: 'old-token',
            workingDirectory: '/old-workspace',
            launchedByExtension: true,
            time: Date.now() - 10 * 24 * 60 * 60 * 1000 // 10 days ago
        };

        when(persistentServerStorage.all).thenReturn([recentServer, oldServer]);

        // Set up health check results
        serverManager.healthCheckResults.set('recent-server', true);
        serverManager.healthCheckResults.set('old-server', true); // old server will be cleaned up due to age

        await serverManager.cleanupServers();

        // Should only remove the old server
        verify(persistentServerStorage.remove('old-server')).once();
        verify(persistentServerStorage.remove('recent-server')).never();
    });
});