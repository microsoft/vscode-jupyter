// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';
import { commands } from 'vscode';

/**
 * Registers the command for setting the interpreter to launch jupyter with
 */
@injectable()
export class JupyterInterpreterSelectionCommand implements IExtensionSyncActivationService {
    constructor(
        @inject(JupyterInterpreterService) private readonly service: JupyterInterpreterService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public activate() {
        this.disposables.push(
            commands.registerCommand('jupyter.selectJupyterInterpreter', () => {
                this.service.selectInterpreter().catch(noop);
            })
        );
    }
}
