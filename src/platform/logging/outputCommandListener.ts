// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { ICommandManager } from '../common/application/types';
import { Commands, JUPYTER_OUTPUT_CHANNEL } from '../common/constants';
import { IDataScienceCommandListener, IDisposableRegistry, IOutputChannel } from '../common/types';

@injectable()
export class OutputCommandListener implements IDataScienceCommandListener {
    constructor(
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) private jupyterOutput: IOutputChannel,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry
    ) {}
    register(commandManager: ICommandManager): void {
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.ViewJupyterOutput, this.viewJupyterOutput, this)
        );
    }

    private viewJupyterOutput() {
        this.jupyterOutput.show(true);
    }
}
