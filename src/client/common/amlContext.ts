// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { setSharedProperty } from '../telemetry';
import { IWorkspaceService } from './application/types';
import { GLOBAL_MEMENTO, IMemento } from './types';
import { noop } from './utils/misc';

const amlComputeMementoKey = 'JVSC_IS_AML_COMPUTE_INSTANCE';

@injectable()
export class AmlComputeContext implements IExtensionSingleActivationService {
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}

    public get isAmlCompute() {
        return this.memento.get<boolean>(amlComputeMementoKey, false) || this.isAmlComputeWorkspace();
    }
    private isAmlComputeWorkspace() {
        let isRemoteConnection: boolean = false;
        // If there is at least 1 folder, we can check if the scheme and authority match a remote connection
        if (Array.isArray(this.workspace.workspaceFolders) && this.workspace.workspaceFolders.length > 0) {
            // We are in a remote connection to a CI if the scheme is vscode-remote and the authority contains amlext
            isRemoteConnection = this.workspace.workspaceFolders.some(
                (item) => item.uri.scheme === 'vscode-remote' && item.uri.authority.indexOf('amlext') >= 0
            );
        }
        return isRemoteConnection;
    }
    public async activate(): Promise<void> {
        if (this.memento.get<boolean>(amlComputeMementoKey, false)) {
            setSharedProperty('isamlcompute', 'yes');
            return;
        }
        if (this.isAmlComputeWorkspace()) {
            setSharedProperty('isamlcompute', 'yes');
            // Next time user opens VSC on this machine, it is known to be an AML compute (even if there are no workspace folders open).
            this.memento.update(amlComputeMementoKey, true).then(noop, noop);
        }
    }
}
