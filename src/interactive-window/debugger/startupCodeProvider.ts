// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { IKernel, isLocalConnection, IStartupCodeProvider, StartupCodePriority } from '../../kernels/types';
import { InteractiveWindowView } from '../../platform/common/constants';
import { splitLines } from '../../platform/common/helpers';
import { IFileSystem } from '../../platform/common/platform/types';
import { IConfigurationService, IExtensionContext, IsWebExtension } from '../../platform/common/types';

@injectable()
export class InteractiveWindowDebuggingStartupCodeProvider implements IStartupCodeProvider {
    public priority = StartupCodePriority.Debugging;
    private addRunCellHookContents?: Promise<string>;

    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IsWebExtension) private readonly isWebExtension: boolean
    ) {}

    async getCode(kernel: IKernel): Promise<string[]> {
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }

        if (!this.isWebExtension) {
            const useNewDebugger = this.configService.getSettings(undefined).forceIPyKernelDebugger === true;
            if (useNewDebugger) {
                return [];
            }
            if (!isLocalConnection(kernel.kernelConnectionMetadata)) {
                return [];
            }
        }

        if (kernel.notebook?.notebookType === InteractiveWindowView) {
            if (!isLocalConnection(kernel.kernelConnectionMetadata)) {
                // With remove kernel connection in the web, we use the new approach, i.e. Jupyter debugger protocol.
                return [];
            }

            // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
            // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
            if (!this.addRunCellHookContents) {
                this.addRunCellHookContents = this.fs.readFile(
                    Uri.joinPath(
                        this.context.extensionUri,
                        'pythonFiles',
                        'vscode_datascience_helpers',
                        'kernel',
                        'addRunCellHook.py'
                    )
                );
            }
            const addRunCellHook = await this.addRunCellHookContents;

            return splitLines(addRunCellHook, { trim: false });
        }
        return [];
    }
}
