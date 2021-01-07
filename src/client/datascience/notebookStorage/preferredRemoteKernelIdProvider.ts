// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento, Uri } from 'vscode';
import { GLOBAL_MEMENTO, ICryptoUtils, IMemento } from '../../common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';

export const ActiveKernelIdList = 'Active_Kernel_Id_List';
// This is the number of kernel ids that will be remembered between opening and closing VS code
export const MaximumKernelIdListSize = 100;

type KernelIdListEntry = {
    fileHash: string;
    kernelId: string | undefined;
};

@injectable()
export class PreferredRemoteKernelIdProvider {
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(ICryptoUtils) private crypto: ICryptoUtils
    ) {}

    public getPreferredRemoteKernelId(uri: Uri): string | undefined {
        // Stored as a list so we don't take up too much space
        const list: KernelIdListEntry[] = this.globalMemento.get<KernelIdListEntry[]>(ActiveKernelIdList, []);
        if (list) {
            // Not using a map as we're only going to store the last 40 items.
            const fileHash = this.crypto.createHash(uri.toString(), 'string');
            const entry = list.find((l) => l.fileHash === fileHash);
            return entry?.kernelId;
        }
    }

    public async storePreferredRemoteKernelId(uri: Uri, id: string | undefined): Promise<void> {
        const list: KernelIdListEntry[] = this.globalMemento.get<KernelIdListEntry[]>(ActiveKernelIdList, []);
        const fileHash = this.crypto.createHash(uri.toString(), 'string');
        const index = list.findIndex((l) => l.fileHash === fileHash);
        // Always remove old spot (we'll push on the back for new ones)
        if (index >= 0) {
            list.splice(index, 1);
        }

        // If adding a new one, push
        if (id) {
            list.push({ fileHash, kernelId: id });
        }

        // Prune list if too big
        while (list.length > MaximumKernelIdListSize) {
            sendTelemetryEvent(Telemetry.TotalNumberOfSavedRemoteKernelIdsExceeded);
            list.shift();
        }
        await this.globalMemento.update(ActiveKernelIdList, list);
    }
}
