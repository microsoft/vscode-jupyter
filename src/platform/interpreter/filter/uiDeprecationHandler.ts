// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../activation/types';
import { ICommandManager } from '../../common/application/types';
import { IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';

@injectable()
export class PythonFilterUICommandDeprecation implements IExtensionSyncActivationService {
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public activate() {
        this.disposables.push(
            this.commandManager.registerCommand(
                'jupyter.filterKernels',
                () =>
                    this.commandManager
                        .executeCommand('workbench.action.openSettings', 'jupyter.kernels.excludePythonEnvironments')
                        .then(noop, noop),
                this
            )
        );
    }
}
