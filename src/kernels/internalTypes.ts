// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event } from 'vscode';
import { KernelConnectionMetadata } from './types';
import type { ObservableDisposable } from '../platform/common/utils/lifecycle';

export enum ContributedKernelFinderKind {
    Remote = 'remote',
    LocalKernelSpec = 'localKernelSpec',
    LocalPythonEnvironment = 'localPythonEnvironment'
}

export interface IContributedKernelFinder<T extends KernelConnectionMetadata = KernelConnectionMetadata>
    extends ObservableDisposable {
    readonly status: 'discovering' | 'idle';
    onDidChangeStatus: Event<void>;
    /**
     * Last error thrown when listing the kernels.
     * Use this property to determine if there was an error fetching kernels when there are no kernels listed.
     */
    readonly lastError?: Error;
    id: string;
    displayName: string;
    kind: ContributedKernelFinderKind;
    onDidChangeKernels: Event<{
        // Expose just the ID, used to minimize the places where we use the old type PythonEnvironment.
        removed?: { id: string }[];
    }>;
    kernels: T[];
    refresh(): Promise<void>;
}
