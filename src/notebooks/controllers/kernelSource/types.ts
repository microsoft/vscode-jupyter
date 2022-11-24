// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event, NotebookDocument, QuickPickItem } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { IDisposable } from '../../../platform/common/types';
export interface ConnectionQuickPickItem extends QuickPickItem {
    connection: KernelConnectionMetadata;
    isRecommended?: boolean;
}
export interface CommandQuickPickItem extends QuickPickItem {
    command: () => Promise<PythonKernelConnectionMetadata | undefined>;
}

export type MultiStepResult = {
    notebook: NotebookDocument;
    source?: IContributedKernelFinder;
    selection?: { type: 'connection'; connection: KernelConnectionMetadata } | { type: 'userPerformedSomeOtherAction' };
    disposables: IDisposable[];
};
export interface IQuickPickKernelItemProvider {
    readonly title: string;
    readonly kind: ContributedKernelFinderKind;
    readonly onDidChange: Event<void>;
    readonly kernels: KernelConnectionMetadata[];
    onDidChangeStatus: Event<void>;
    onDidChangeRecommended: Event<void>;
    status: 'discovering' | 'idle';
    refresh: () => Promise<void>;
    recommended: KernelConnectionMetadata | undefined;
    finder?: IContributedKernelFinder;
}
