// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { KernelConnectionMetadata, isRemoteConnection } from './types';
import { Memento } from 'vscode';

type CachedKernelInfo = {
    id: string;
    info: KernelMessage.IInfoReply;
    // Time when this was stored in mememto.
    age: number;
};
const KEY = 'KERNEL_INFO';
const CACHE_EXPIRY_IN_MS = 1000 * 60 * 60 * 24 * 2;

export async function cacheKernelInfo(
    storage: Memento,
    kernelConnection: KernelConnectionMetadata,
    info: KernelMessage.IInfoReply | undefined
) {
    if (!info || !isRemoteConnection(kernelConnection)) {
        return;
    }
    const kernelInfos = storage
        .get<CachedKernelInfo[]>(KEY, [])
        .filter((item) => Date.now() - item.age < CACHE_EXPIRY_IN_MS)
        .filter((item) => item.id !== kernelConnection.id);
    kernelInfos.push({
        id: kernelConnection.id,
        age: Date.now(),
        info
    });

    await storage.update(KEY, kernelInfos);
}
export function getCacheKernelInfo(storage: Memento, kernelConnection: KernelConnectionMetadata) {
    if (!isRemoteConnection(kernelConnection)) {
        return;
    }
    return storage.get<CachedKernelInfo[]>(KEY, []).find((item) => item.id === kernelConnection.id)?.info;
}
