// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { getAssociatedNotebookDocument } from '../../kernels/helpers';
import { IKernel, IStartupCodeProvider, StartupCodePriority } from '../../kernels/types';
import { InteractiveWindowView } from '../../platform/common/constants';
const addRunCellHook = require('../../pythonFiles/vscode_datascience_helpers/kernel/addRunCellHook.py');

@injectable()
export class InteractiveWindowDebuggingStartupCodeProvider implements IStartupCodeProvider {
    public priority = StartupCodePriority.Debugging;

    constructor() {}

    async getCode(kernel: IKernel): Promise<string[]> {
        if (getAssociatedNotebookDocument(kernel)?.notebookType === InteractiveWindowView) {
            // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
            // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
            return addRunCellHook.splitLines({ trim: false });
        }
        return [];
    }
}
