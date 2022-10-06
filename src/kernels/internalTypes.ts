// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event } from 'vscode';
import { Resource } from '../platform/common/types';
import { KernelConnectionMetadata } from './types';

export interface IContributedKernelFinder extends IContributedKernelFinderInfo {
    kind: string;
    initialized: Promise<void>;
    onDidChangeKernels: Event<void>;
    listContributedKernels(resource: Resource): KernelConnectionMetadata[];
}

export interface IContributedKernelFinderInfo {
    id: string;
    displayName: string;
}
