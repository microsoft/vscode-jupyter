// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { CancellationToken } from 'vscode';
import { Resource } from '../platform/common/types';
import { KernelConnectionMetadata } from './types';

export interface IContributedKernelFinder {
    kind: string;
    listContributedKernels(
        resource: Resource,
        cancelToken: CancellationToken | undefined,
        useCache: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]>;
}
