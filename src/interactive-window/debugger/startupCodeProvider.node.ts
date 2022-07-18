// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { getAssociatedNotebookDocument } from '../../kernels/helpers';
import { IKernel, isLocalConnection, IStartupCodeProvider } from '../../kernels/types';
import { InteractiveWindowView } from '../../platform/common/constants';
import { IFileSystem } from '../../platform/common/platform/types';
import { AddRunCellHook } from '../../platform/common/scriptConstants';
import { IConfigurationService, IExtensionContext } from '../../platform/common/types';
import { traceError } from '../../platform/logging';

@injectable()
export class InteractiveWindowDebuggingStartupCodeProvider implements IStartupCodeProvider {
    public priority: number = 10;
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    async getCode(kernel: IKernel): Promise<string[]> {
        const useNewDebugger = this.configService.getSettings(undefined).forceIPyKernelDebugger === true;
        if (useNewDebugger) {
            return [];
        }
        if (!isLocalConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }
        // Only do this for interactive windows. IPYKERNEL_CELL_NAME is set other ways in
        // notebooks
        if (getAssociatedNotebookDocument(kernel)?.notebookType === InteractiveWindowView) {
            // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
            // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
            const scriptPath = AddRunCellHook.getScriptPath(this.context);
            if (await this.fs.exists(scriptPath)) {
                const fileContents = await this.fs.readFile(scriptPath);
                return fileContents.splitLines({ trim: false });
            }
            traceError(`Cannot run non-existent script file: ${scriptPath}`);
        }
        return [];
    }
}
