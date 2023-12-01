// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, extensions } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { PythonExtension, PylanceExtension } from '../../constants';
import { noop } from '../../utils/misc';
import { ICommandManager } from '../types';
import { workspace } from 'vscode';

/**
 * Allows the jupyter extension to run in a different process than other extensions.
 */
@injectable()
export class RunInDedicatedExtensionHostCommandHandler implements IExtensionSyncActivationService {
    constructor(@inject(ICommandManager) private readonly commandManager: ICommandManager) {}
    public activate() {
        this.commandManager.registerCommand('jupyter.runInDedicatedExtensionHost', this.updateAffinity, this);
    }
    private async updateAffinity() {
        const affinity = workspace.getConfiguration('extensions').get('experimental.affinity') as
            | { [key: string]: number }
            | undefined;
        let maxAffinity = 0;
        if (affinity) {
            Object.values(affinity).forEach((value) => {
                maxAffinity = Math.max(maxAffinity, value);
            });
        }

        const targetAffinity = maxAffinity + 1;

        let update: { [key: string]: number } = {
            'ms-toolsai.jupyter': targetAffinity,
            'ms-toolsai.jupyter-renderers': targetAffinity
        };

        if (extensions.getExtension(PythonExtension)) {
            update[PythonExtension] = targetAffinity;
        }

        if (extensions.getExtension(PylanceExtension)) {
            update[PylanceExtension] = targetAffinity;
        }

        await workspace.getConfiguration('extensions').update(
            'experimental.affinity',
            {
                ...(affinity ?? {}),
                ...update
            },
            ConfigurationTarget.Global
        );

        this.commandManager.executeCommand('workbench.action.reloadWindow').then(noop, noop);
    }
}
