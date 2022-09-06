// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event } from 'vscode';
import { Resource } from '../platform/common/types';
import { KernelConnectionMetadata } from './types';

export interface IContributedKernelFinder {
    kind: string;
    initialized: Promise<void>;
    onDidChangeKernels: Event<void>;
    listContributedKernels(resource: Resource): KernelConnectionMetadata[];
}
