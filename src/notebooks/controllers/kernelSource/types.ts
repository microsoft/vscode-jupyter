// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, NotebookDocument, QuickPickItem } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { IDisposable } from '../../../platform/common/types';
export interface ConnectionQuickPickItem extends QuickPickItem {
    connection: KernelConnectionMetadata;
    isRecommended?: boolean;
}
export interface KernelListErrorQuickPickItem extends QuickPickItem {
    error: Error;
}
export interface ConnectionSeparatorQuickPickItem extends QuickPickItem {
    isEmptyCondaEnvironment?: boolean;
}
export interface CommandQuickPickItem extends QuickPickItem {
    command: () => Promise<PythonKernelConnectionMetadata | undefined>;
}

export type MultiStepResult<T extends KernelConnectionMetadata = KernelConnectionMetadata> = {
    notebook: NotebookDocument;
    source?: IContributedKernelFinder;
    selection?: { type: 'connection'; connection: T } | { type: 'userPerformedSomeOtherAction' };
    disposables: IDisposable[];
};
export interface IQuickPickKernelItemProvider {
    readonly title: string;
    readonly kind: ContributedKernelFinderKind;
    readonly onDidChange: Event<void>;
    readonly onDidFailToListKernels: Event<Error>;
    readonly kernels: KernelConnectionMetadata[];
    onDidChangeStatus: Event<void>;
    onDidChangeRecommended: Event<void>;
    status: 'discovering' | 'idle';
    refresh: () => Promise<void>;
    recommended: KernelConnectionMetadata | undefined;
    finder?: IContributedKernelFinder;
}
