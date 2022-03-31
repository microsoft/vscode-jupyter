// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../../webviews/webview-side/common/constants';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';

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
