// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { window } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager } from '../../common/application/types';
import { Experiments } from '../../common/experiments/groups';
import { IDisposableRegistry, IExperimentService } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { JupyterServersTreeDataProvider } from './serversTreeDataProvider';

@injectable()
export class JupyterServersTreeView implements IExtensionSingleActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(JupyterServersTreeDataProvider) private readonly dataProvider: JupyterServersTreeDataProvider,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IExperimentService) private readonly experiments: IExperimentService
    ) {}
    public async activate(): Promise<void> {
        // This must happen when extension loads.
        this.disposables.push(window.registerTreeDataProvider('jupyter.serversView', this.dataProvider));
        // This can happen in the background & need not block extension loading.
        this.experiments
            .inExperiment(Experiments.RemoteJupyter)
            .then((enabled) =>
                enabled
                    ? this.commandManager.executeCommand('setContext', 'remoteJupyterExperimentEnabled', true)
                    : Promise.resolve()
            )
            .then(noop, noop);
    }
}
