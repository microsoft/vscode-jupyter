// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, multiInject, optional } from 'inversify';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { ICommandManager } from '../../platform/common/application/types';

import { IDataScienceCommandListener, IDisposable } from '../../platform/common/types';

@injectable()
export class CommandRegistry implements IDisposable, IExtensionSingleActivationService {
    constructor(
        @multiInject(IDataScienceCommandListener)
        @optional()
        private commandListeners: IDataScienceCommandListener[] | undefined,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {}
    public async activate(): Promise<void> {
        if (this.commandListeners) {
            this.commandListeners.forEach((listener: IDataScienceCommandListener) => {
                listener.register(this.commandManager);
            });
        }
    }
    public dispose() {
        //
    }
}
