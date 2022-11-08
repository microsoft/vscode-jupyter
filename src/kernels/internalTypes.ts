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
    id: string;
    displayName: string;
    kind: ContributedKernelFinderKind;
    onDidChangeKernels: Event<void>;
    kernels: T[];
}
