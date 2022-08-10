// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import {
    IApplicationShell,
    ICommandManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../platform/common/application/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { IFileConverter } from '../../notebooks/export/types';
import { ExportCommands } from './exportCommands';
import { IControllerSelection, IControllerPreferredService } from '../../notebooks/controllers/types';

/**
 * Registers the export commands if in a trusted workspace.
 */
@injectable()
export class CommandRegistry implements IExtensionSingleActivationService {
    private exportCommand?: ExportCommands;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IFileConverter) private fileConverter: IFileConverter,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider)
        @optional()
        private readonly interactiveProvider: IInteractiveWindowProvider | undefined,
        @inject(IControllerSelection) readonly controllerSelection: IControllerSelection,
        @inject(IControllerPreferredService) readonly controllerPreferred: IControllerPreferredService
    ) {
        this.exportCommand = new ExportCommands(
            this.commandManager,
            this.fileConverter,
            this.applicationShell,
            this.fs,
            this.notebooks,
            this.interactiveProvider,
            controllerSelection,
            controllerPreferred
        );
        if (!this.workspace.isTrusted) {
            this.workspace.onDidGrantWorkspaceTrust(this.registerCommandsIfTrusted, this, this.disposables);
        }
    }

    async activate(): Promise<void> {
        this.registerCommandsIfTrusted();
    }

    private registerCommandsIfTrusted() {
        if (!this.workspace.isTrusted) {
            return;
        }
        this.exportCommand?.register();
    }
}
