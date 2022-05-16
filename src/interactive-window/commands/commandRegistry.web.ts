// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, optional } from 'inversify';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IWorkspaceService } from '../../platform/common/application/types';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { IExportCommands } from '../types';

@injectable()
export class CommandRegistry implements IDisposable, IExtensionSingleActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExportCommands) @optional() private readonly exportCommand: IExportCommands | undefined,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
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

    dispose(): void {
        /** Do nothing. */
    }
}
