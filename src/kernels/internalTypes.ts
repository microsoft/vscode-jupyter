// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event } from 'vscode';
import { KernelConnectionMetadata } from './types';

export enum ContributedKernelFinderKind {
    Remote = 'remote',
    LocalKernelSpec = 'localKernelSpec',
    LocalPythonEnvironment = 'localPythonEnvironment'
}

export interface IContributedKernelFinder<T extends KernelConnectionMetadata = KernelConnectionMetadata> {
    status: 'discovering' | 'idle';
    onDidChangeStatus: Event<void>;
    /**
     * Last error thrown when listing the kernels.
     * Use this property to determine if there was an error fetching kernels when there are no kernels listed.
     */
    lastError?: Error;
    id: string;
    displayName: string;
    kind: ContributedKernelFinderKind;
    onDidChangeKernels: Event<{
        added?: T[];
        updated?: T[];
        removed?: T[];
    }>;
    kernels: T[];
    refresh(): Promise<void>;
}
