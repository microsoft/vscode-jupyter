// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Memento } from 'vscode';
import { noop } from './utils/misc';
import { IExtensionSyncActivationService } from '../activation/types';
import { IApplicationEnvironment, IWorkspaceService } from './application/types';
import { GLOBAL_MEMENTO, ICryptoUtils, IMemento, WORKSPACE_MEMENTO } from './types';
import { inject, injectable, named } from 'inversify';
import { getFilePath } from './platform/fs-paths';

@injectable()
export class OldCacheCleaner implements IExtensionSyncActivationService {
    constructor(
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(ICryptoUtils) private readonly crypto: ICryptoUtils,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private readonly workspaceState: Memento
    ) {}
    public activate(): void {
        this.removeOldCachedItems().then(noop, noop);
    }
    async removeOldCachedItems(): Promise<void> {
        await Promise.all(
            [
                await this.getUriAccountKey(),
                'currentServerHash',
                'connectToLocalKernelsOnly',
                'JUPYTER_LOCAL_KERNELSPECS',
                'JUPYTER_LOCAL_KERNELSPECS_V1',
                'JUPYTER_LOCAL_KERNELSPECS_V2',
                'JUPYTER_LOCAL_KERNELSPECS_V3',
                'JUPYTER_REMOTE_KERNELSPECS',
                'JUPYTER_REMOTE_KERNELSPECS_V1',
                'JUPYTER_REMOTE_KERNELSPECS_V2',
                'JUPYTER_REMOTE_KERNELSPECS_V3',
                'JUPYTER_LOCAL_KERNELSPECS_V4',
                'LOCAL_KERNEL_SPECS_CACHE_KEY_V_2022_10',
                'LOCAL_KERNEL_PYTHON_AND_RELATED_SPECS_CACHE_KEY_V_2022_10',
                'user-jupyter-server-uri-list-v2'
            ]
                .filter((key) => this.globalState.get(key, undefined) !== undefined)
                .map((key) => this.globalState.update(key, undefined).then(noop, noop))
        );
        const workspaceStateKeysToRemove = this.workspaceState
            .keys()
            .filter((key) => key.startsWith('LAST_EXECUTED_CELL_') && !key.startsWith('LAST_EXECUTED_CELL_V2_'));
        await Promise.all(workspaceStateKeysToRemove.map((key) => this.workspaceState.update(key, undefined)));
    }

    async getUriAccountKey(): Promise<string> {
        if (this.workspace.rootFolder) {
            // Folder situation
            return this.crypto.createHash(getFilePath(this.workspace.rootFolder), 'SHA-512');
        } else if (this.workspace.workspaceFile) {
            // Workspace situation
            return this.crypto.createHash(getFilePath(this.workspace.workspaceFile), 'SHA-512');
        }
        return this.appEnv.machineId; // Global key when no folder or workspace file
    }
}
