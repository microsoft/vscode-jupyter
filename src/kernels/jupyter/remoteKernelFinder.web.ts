// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { injectable } from 'inversify';
import { INotebookProviderConnection, KernelConnectionMetadata } from '../types';
import { Resource } from '../../platform/common/types';
import { IRemoteKernelFinder } from '../raw/types';

// This is a temporary class to just get the NotebookControllerManager to load in a web context.
@injectable()
export class RemoteKernelFinder implements IRemoteKernelFinder {
    // Talk to the remote server to determine sessions
    public async listKernels(
        _resource: Resource,
        _connInfo: INotebookProviderConnection | undefined
    ): Promise<KernelConnectionMetadata[]> {
        return [];
    }
}
