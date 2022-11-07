// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands } from 'vscode';
import { IConnectionMru } from '../../notebooks/controllers/types';
import { IExtensionContext } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { IServiceManager } from '../../platform/ioc/types';

export function addClearCacheCommand(context: IExtensionContext, isDevMode: boolean, serviceManager: IServiceManager) {
    if (!isDevMode) {
        return;
    }
    commands.registerCommand('dataScience.ClearCache', () => {
        // eslint-disable-next-line no-restricted-syntax
        for (const key of context.globalState.keys()) {
            context.globalState.update(key, undefined).then(noop, noop);
        }
        // eslint-disable-next-line no-restricted-syntax
        for (const key of context.workspaceState.keys()) {
            context.workspaceState.update(key, undefined).then(noop, noop);
        }

        const mru = serviceManager.get<IConnectionMru>(IConnectionMru);
        if (mru.clear) {
            mru.clear().catch(noop);
        }
    });
}
