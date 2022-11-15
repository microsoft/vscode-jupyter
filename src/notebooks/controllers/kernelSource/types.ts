// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { NotebookDocument, QuickPickItem } from 'vscode';
import { IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { IDisposable } from '../../../platform/common/types';
export interface ConnectionQuickPickItem extends QuickPickItem {
    connection: KernelConnectionMetadata;
}

export type MultiStepResult = {
    notebook: NotebookDocument;
    source?: IContributedKernelFinder;
    connection?: KernelConnectionMetadata;
    disposables: IDisposable[];
};
