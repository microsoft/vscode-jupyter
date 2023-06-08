// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Memento } from 'vscode';
import { noop } from './utils/misc';
import { IExtensionSyncActivationService } from '../activation/types';
import { IApplicationEnvironment, IWorkspaceService } from './application/types';
import { GLOBAL_MEMENTO, ICryptoUtils, IMemento } from './types';
import { inject, injectable, named } from 'inversify';
import { getFilePath } from './platform/fs-paths';

@injectable()
export class OldCacheCleaner implements IExtensionSyncActivationService {
    constructor(
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(ICryptoUtils) private readonly crypto: ICryptoUtils,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment
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
                'LOCAL_KERNEL_PYTHON_AND_RELATED_SPECS_CACHE_KEY_V_2022_10'
            ]
                .filter((key) => this.globalState.get(key, undefined) !== undefined)
                .map((key) => this.globalState.update(key, undefined).then(noop, noop))
        );
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
