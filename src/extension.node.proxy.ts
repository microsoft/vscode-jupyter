// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IExtensionApi } from './standalone/api/api';
import type { IExtensionContext } from './platform/common/types';
import { ExtensionMode } from 'vscode';

let realEntryPoint: {
    activate: typeof activate;
    deactivate: typeof deactivate;
};
export async function activate(context: IExtensionContext): Promise<IExtensionApi> {
    const entryPoint = context.extensionMode === ExtensionMode.Test ? '../out/extension.node' : './extension.node';
    try {
        realEntryPoint = (0, eval)('require')(entryPoint);
        return realEntryPoint.activate(context);
    } catch (ex) {
        console.error('Failed to activate extension, falling back to `./extension.node`', ex);
        // In smoke tests, we do not want to load the out/extension.node.
        realEntryPoint = (0, eval)('require')('./extension.node');
        return realEntryPoint.activate(context);
    }
}

export function deactivate(): Thenable<void> {
    return realEntryPoint.deactivate();
}
