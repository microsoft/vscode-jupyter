// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { GLOBAL_MEMENTO, IMemento } from '../../common/types';
import { swallowExceptions } from '../../common/utils/decorators';
import { noop } from '../../common/utils/misc';
import { RemoteFileSchemeManager } from '../connection/fileSchemeManager';
import { JupyterServerConnectionService } from '../connection/remoteConnectionsService';
import { RemoteFileSystem } from './fileSystem';
import { IJupyterServerConnectionService, JupyterServerConnection } from './types';

type FileSchemeBaseUri = {
    scheme: string;
};
@injectable()
export class RemoteFileSystemFactory implements IExtensionSingleActivationService {
    private readonly fileSystemsByScheme = new Map<string, RemoteFileSystem>();
    private fileSystems = new Map<string, Promise<RemoteFileSystem>>();
    private previousUpdate = Promise.resolve();
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: Memento,
        @inject(IJupyterServerConnectionService) private readonly connectionService: JupyterServerConnectionService,
        @inject(RemoteFileSchemeManager) private readonly fileSchemeManager: RemoteFileSchemeManager
    ) {}
    /**
     * If users leave a remote file open & close/reload VS Code, then we need to ensure we re-connect back to those servers.
     * This ensures we first register those file systems providers with VS Code, so that its ready when VS Code asks for the content.
     * At the point when VSC asks for content, the file system provider will ensure user is authenticated.
     */
    public async activate(): Promise<void> {
        const remoteJupyterFileSchemes = this.globalState.get<FileSchemeBaseUri[]>('REMOTE_JUPYTER_FILE_SCHEMES', []);
        if (Array.isArray(remoteJupyterFileSchemes) && remoteJupyterFileSchemes.length) {
            for (const remoteJupyterFileScheme of remoteJupyterFileSchemes) {
                if (this.fileSystemsByScheme.has(remoteJupyterFileScheme.scheme)) {
                    continue;
                }
                const fileSystem = new RemoteFileSystem(
                    undefined,
                    remoteJupyterFileScheme.scheme,
                    this.connectionService,
                    this.fileSchemeManager
                );
                this.fileSystemsByScheme.set(remoteJupyterFileScheme.scheme, fileSystem);
            }
        }
    }
    public async getOrCreateRemoteFileSystem(connection: JupyterServerConnection) {
        if (!this.fileSystems.has(connection.id)) {
            this.fileSystems.set(connection.id, this.createRemoteFileSystem(connection));
        }
        return this.fileSystems.get(connection.id)!;
    }
    public getRemoteFileSystem(scheme: string) {
        return this.fileSystemsByScheme.get(scheme);
    }
    private async createRemoteFileSystem(connection: JupyterServerConnection) {
        const fileScheme = connection.fileScheme;
        let fileSystem = this.fileSystemsByScheme.get(fileScheme);
        if (!fileSystem || fileSystem.isDisposed) {
            fileSystem = new RemoteFileSystem(
                connection.id,
                fileScheme,
                this.connectionService,
                this.fileSchemeManager
            );
        }
        this.fileSystemsByScheme.set(fileScheme, fileSystem);
        this.addFileSchemeToGlobalStorage(fileScheme).catch(noop);
        return fileSystem;
    }
    @swallowExceptions('Saving file schemes')
    private async addFileSchemeToGlobalStorage(fileScheme: string) {
        this.previousUpdate = this.previousUpdate.finally(async () => {
            const schemes = this.globalState.get<FileSchemeBaseUri[]>('REMOTE_JUPYTER_FILE_SCHEMES', []);
            schemes.push({ scheme: fileScheme });
            this.globalState.update('REMOTE_JUPYTER_FILE_SCHEMES', schemes).then(noop, noop);
        });
    }
}
