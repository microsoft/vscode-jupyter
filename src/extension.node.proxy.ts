// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IExtensionApi } from './standalone/api';
import type { IExtensionContext } from './platform/common/types';
import { ExtensionMode } from 'vscode';

let realEntryPoint: {
    activate: typeof activate;
    deactivate: typeof deactivate;
};
export async function activate(context: IExtensionContext): Promise<IExtensionApi> {
    const entryPoint = context.extensionMode === ExtensionMode.Test ? '../out/extension.node' : './extension.node';
    try {
        realEntryPoint = eval('require')(entryPoint); // CodeQL [SM04509] Usage of eval in this context is safe (we do not want bundlers to import code when it sees `require`).
        return realEntryPoint.activate(context);
    } catch (ex) {
        if (!ex.toString().includes(`Cannot find module '../out/extension.node'`)) {
            console.error('Failed to activate extension, falling back to `./extension.node`', ex);
        }
        // In smoke tests, we do not want to load the out/extension.node.
        realEntryPoint = eval('require')('./extension.node'); // CodeQL [SM04509] Usage of eval in this context is safe (we do not want bundlers to import code when it sees `require`)
        return realEntryPoint.activate(context);
    }
}

export function deactivate(): Thenable<void> {
    return realEntryPoint.deactivate();
}
