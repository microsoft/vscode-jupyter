// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { injectable, inject } from 'inversify';
import { commands } from 'vscode';

@injectable()
export class ExposeUsedAzMLServerHandles implements IExtensionSyncActivationService {
    constructor(@inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage) {}
    activate(): void {
        commands.registerCommand('jupyter.getUsedAzMLServerHandles', () => {
            const usedItems: { id: string; handle: string }[] = [];
            const items = this.uriStorage.all;
            items.forEach((item) => {
                if (item.provider.extensionId.toLowerCase() === 'ms-toolsai.vscode-ai'.toLowerCase()) {
                    usedItems.push(item.provider);
                }
            });
            return usedItems;
        });
    }
}
