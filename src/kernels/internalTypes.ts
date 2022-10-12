// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event } from 'vscode';
import { Resource } from '../platform/common/types';
import { KernelConnectionMetadata } from './types';

export enum ContributedKernelFinderKind {
    Remote = 'remote',
    Local = 'local'
}

export interface IContributedKernelFinder<T extends KernelConnectionMetadata> extends IContributedKernelFinderInfo {
    kind: ContributedKernelFinderKind;
    initialized: Promise<void>;
    onDidChangeKernels: Event<void>;
    listContributedKernels(resource: Resource): T[];
}

export interface IContributedKernelFinderInfo {
    id: string;
    displayName: string;
}
