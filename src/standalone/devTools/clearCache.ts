// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands, window, workspace } from 'vscode';
import { IExtensionContext } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { traceInfo } from '../../platform/logging';

export function addClearCacheCommand(context: IExtensionContext, isDevMode: boolean) {
    if (!isDevMode) {
        return;
    }
    commands.registerCommand('dataScience.ClearCache', async () => {
        const promises: Thenable<unknown>[] = [];
        context.globalState
            .keys()
            .forEach((k) => promises.push(context.globalState.update(k, undefined).then(noop, noop)));
        context.workspaceState
            .keys()
            .forEach((k) => promises.push(context.workspaceState.update(k, undefined).then(noop, noop)));
        promises.push(
            workspace.fs.delete(context.globalStorageUri, { recursive: true, useTrash: false }).then(noop, noop)
        );
        await Promise.all(promises);

        traceInfo('Cache cleared');
        window.showInformationMessage('Cache cleared').then(noop, noop);
    });
}
