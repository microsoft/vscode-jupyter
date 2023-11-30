// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { IFileConverter } from '../../notebooks/export/types';
import { ExportCommands } from './exportCommands';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { IKernelFinder } from '../../kernels/types';
import { PreferredKernelConnectionService } from '../../notebooks/controllers/preferredKernelConnectionService';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import { workspace } from 'vscode';

/**
 * Registers the export commands if in a trusted workspace.
 */
@injectable()
export class CommandRegistry implements IExtensionSyncActivationService {
    private exportCommand?: ExportCommands;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IFileConverter) private fileConverter: IFileConverter,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider)
        @optional()
        private readonly interactiveProvider: IInteractiveWindowProvider | undefined,
        @inject(IControllerRegistration) readonly controllerSelection: IControllerRegistration,
        @inject(IKernelFinder) readonly kernelFinder: IKernelFinder,
        @inject(JupyterConnection) readonly jupyterConnection: JupyterConnection
    ) {
        this.exportCommand = new ExportCommands(
            this.commandManager,
            this.fileConverter,
            this.applicationShell,
            this.fs,
            this.notebooks,
            this.interactiveProvider,
            controllerSelection,
            new PreferredKernelConnectionService(jupyterConnection),
            kernelFinder
        );
        if (!workspace.isTrusted) {
            workspace.onDidGrantWorkspaceTrust(this.registerCommandsIfTrusted, this, this.disposables);
        }
    }

    activate() {
        this.registerCommandsIfTrusted();
    }

    private registerCommandsIfTrusted() {
        if (!workspace.isTrusted) {
            return;
        }
        this.exportCommand?.register();
    }
}
