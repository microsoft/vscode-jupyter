// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    IApplicationShell,
    ICommandManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../platform/common/application/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IDisposableRegistry, IFeaturesManager } from '../../platform/common/types';
import { IFileConverter } from '../../notebooks/export/types';
import { ExportCommands } from './exportCommands';
import { IControllerRegistration, IControllerPreferredService } from '../../notebooks/controllers/types';
import { IKernelFinder } from '../../kernels/types';
import { PreferredKernelConnectionService } from '../../notebooks/controllers/preferredKernelConnectionService';

/**
 * Registers the export commands if in a trusted workspace.
 */
@injectable()
export class CommandRegistry implements IExtensionSyncActivationService {
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
        @inject(IControllerRegistration) readonly controllerSelection: IControllerRegistration,
        @inject(IControllerPreferredService) readonly controllerPreferred: IControllerPreferredService,
        @inject(IKernelFinder) readonly kernelFinder: IKernelFinder,
        @inject(IFeaturesManager) readonly featureManager: IFeaturesManager
    ) {
        this.exportCommand = new ExportCommands(
            this.commandManager,
            this.fileConverter,
            this.applicationShell,
            this.fs,
            this.notebooks,
            this.interactiveProvider,
            controllerSelection,
            controllerPreferred,
            new PreferredKernelConnectionService(),
            kernelFinder,
            featureManager
        );
        if (!this.workspace.isTrusted) {
            this.workspace.onDidGrantWorkspaceTrust(this.registerCommandsIfTrusted, this, this.disposables);
        }
    }

    activate() {
        this.registerCommandsIfTrusted();
    }

    private registerCommandsIfTrusted() {
        if (!this.workspace.isTrusted) {
            return;
        }
        this.exportCommand?.register();
    }
}
