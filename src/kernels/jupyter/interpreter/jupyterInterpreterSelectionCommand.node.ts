// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';

/**
 * Registers the command for setting the interpreter to launch jupyter with
 */
@injectable()
export class JupyterInterpreterSelectionCommand implements IExtensionSingleActivationService {
    constructor(
        @inject(JupyterInterpreterService) private readonly service: JupyterInterpreterService,
        @inject(ICommandManager) private readonly cmdManager: ICommandManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public async activate(): Promise<void> {
        this.disposables.push(
            this.cmdManager.registerCommand('jupyter.selectJupyterInterpreter', () => {
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreterCommand);
                this.service.selectInterpreter().ignoreErrors();
            })
        );
    }
}
