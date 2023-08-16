// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { ICommandManager } from '../../platform/common/application/types';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { injectable, inject } from 'inversify';

@injectable()
export class ExposeUsedAzMLServerHandles implements IExtensionSyncActivationService {
    constructor(
        @inject(ICommandManager) private readonly commands: ICommandManager,
        @inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage
    ) {}
    activate(): void {
        this.commands.registerCommand('jupyter.getUsedAzMLServerHandles', async () => {
            const usedItems: { id: string; handle: string }[] = [];
            const items = await this.uriStorage.getAll();
            items.forEach((item) => {
                if (item.provider.extensionId.toLowerCase() === 'ms-toolsai.vscode-ai'.toLowerCase()) {
                    usedItems.push(item.provider);
                }
            });
            return usedItems;
        });
    }
}
