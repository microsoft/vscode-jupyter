// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event } from 'vscode';
import { KernelConnectionMetadata } from './types';

export enum ContributedKernelFinderKind {
    Remote = 'remote',
    Local = 'local'
}

export interface IContributedKernelFinder<T extends KernelConnectionMetadata> extends IContributedKernelFinderInfo {
    kind: ContributedKernelFinderKind;
    onDidChangeKernels: Event<void>;
    kernels: T[];
}

export interface IContributedKernelFinderInfo {
    id: string;
    displayName: string;
}
