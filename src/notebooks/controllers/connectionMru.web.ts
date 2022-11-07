// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { KernelConnectionMetadata } from '../../kernels/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { IKernelRankingHelper, IConnectionMru } from './types';

@injectable()
export class ConnectionMru implements IConnectionMru {
    constructor(@inject(IKernelRankingHelper) private readonly kernelRankingHelper: IKernelRankingHelper) {}

    public async add(_notebook: NotebookDocument, _connection: KernelConnectionMetadata): Promise<void> {
        // No need to do anything special.
        // In Web we can only select kernel specs or live remote kernels.
        // & upon selecting a kernel spec, we'll update the notebook metadata with the kernel spec info.
        // Hence next time we try to match the kernel spec with the metadata we can get an exact match.
        // Also if the user were to run a cell against this kernel spec,
        // Then we start a kernel and that session id of that kernel is stored elsewhere
        // & when we try to match that live session with the notebook we can get an exact match.
        // However this does mean that we will only keep track of the last used kernel connection for a single remote per notebook on the web.
        // For now that fine. The assumption is that this is acceptable, as users are unlikely to switch between multiples,
        // We'll find out when we get feedback.
    }

    public async exists(notebook: NotebookDocument, connection: KernelConnectionMetadata): Promise<boolean> {
        return this.kernelRankingHelper.isExactMatch(notebook.uri, connection, getNotebookMetadata(notebook));
    }
}
