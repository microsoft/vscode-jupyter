// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event } from 'vscode';
import { IQuickPickItemProvider } from '../../../platform/common/providerBasedQuickPick';
import { RemoteKernelConnectionMetadata } from '../../types';

export class LocalKnowPathKernelSpecFinder implements IQuickPickItemProvider<RemoteKernelConnectionMetadata> {
    title: string;
    onDidChange: Event<void>;
    onDidChangeStatus: Event<void>;
    items: readonly RemoteKernelConnectionMetadata[];
    status: 'discovering' | 'idle';
    refresh(): Promise<void> {
        throw new Error('Method not implemented.');
    }

}
