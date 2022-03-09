// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../../client/activation/types';
import { ICommandManager } from '../../../client/common/application/types';
import { IDisposableRegistry } from '../../../client/common/types';
import { sendTelemetryEvent } from '../../../client/telemetry';
import { Telemetry } from '../../../datascience-ui/common/constants';
import { JupyterInterpreterService } from './jupyterInterpreterService';

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
