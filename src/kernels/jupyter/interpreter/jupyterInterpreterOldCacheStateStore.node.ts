// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { IPersistentState, IPersistentStateFactory } from '../../../platform/common/types';

type CacheInfo = {
    /**
     * Cache store (across VSC sessions).
     *
     * @type {IPersistentState<string | undefined>}
     */
    state: IPersistentState<string | undefined>;
};

/**
 * Old way to store the global jupyter interpreter
 */
@injectable()
export class JupyterInterpreterOldCacheStateStore {
    private readonly workspaceJupyterInterpreter: CacheInfo;
    private readonly globalJupyterInterpreter: CacheInfo;
    constructor(
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPersistentStateFactory) persistentStateFactory: IPersistentStateFactory
    ) {
        // Cache stores to keep track of jupyter interpreters found.
        const workspaceState =
            persistentStateFactory.createWorkspacePersistentState<string>('DS-VSC-JupyterInterpreter');
        const globalState = persistentStateFactory.createGlobalPersistentState<string>('DS-VSC-JupyterInterpreter');
        this.workspaceJupyterInterpreter = { state: workspaceState };
        this.globalJupyterInterpreter = { state: globalState };
    }
    private get cacheStore(): CacheInfo {
        return this.workspace.hasWorkspaceFolders ? this.workspaceJupyterInterpreter : this.globalJupyterInterpreter;
    }
    public getCachedInterpreterPath(): Uri | undefined {
        return this.cacheStore.state.value ? Uri.file(this.cacheStore.state.value) : undefined;
    }
    public async clearCache(): Promise<void> {
        await this.cacheStore.state.updateValue(undefined);
    }
}
