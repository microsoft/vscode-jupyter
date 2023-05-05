// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { IKernelSession, KernelConnectionMetadata, isRemoteConnection } from './types';
import { Memento } from 'vscode';
import { traceVerbose, traceWarning } from '../platform/logging';
import { noop } from '../platform/common/utils/misc';
import { sleep } from '../platform/common/utils/async';

type CachedKernelInfo = {
    id: string;
    info: KernelMessage.IInfoReply;
    // Time when this was stored in mememto.
    age: number;
};
const KEY = 'KERNEL_INFO';
const CACHE_EXPIRY_IN_MS = 1000 * 60 * 60 * 24 * 2;

export async function getKernelInfo(
    session: IKernelSession,
    kernelConnectionMetadata: KernelConnectionMetadata,
    workspaceMemento: Memento
) {
    const promises: Promise<
        KernelMessage.IReplyErrorContent | KernelMessage.IReplyAbortContent | KernelMessage.IInfoReply | undefined
    >[] = [];

    const defaultResponse: KernelMessage.IInfoReply = {
        banner: '',
        help_links: [],
        implementation: '',
        implementation_version: '',
        language_info: { name: '', version: '' },
        protocol_version: '',
        status: 'ok'
    };
    const kernelInfoPromise = session.requestKernelInfo().then((item) => item?.content);
    promises.push(kernelInfoPromise);
    kernelInfoPromise
        .then((content) =>
            cacheKernelInfo(workspaceMemento, kernelConnectionMetadata, content as KernelMessage.IInfoReply | undefined)
        )
        .catch(noop);
    // If this doesn't complete in 5 seconds for remote kernels, assume the kernel is busy & provide some default content.
    if (kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel') {
        const cachedInfo = getCacheKernelInfo(workspaceMemento, kernelConnectionMetadata);
        if (cachedInfo) {
            promises.push(Promise.resolve(cachedInfo));
        } else {
            promises.push(sleep(5_000).then(() => defaultResponse));
        }
    }
    const content = await Promise.race(promises);
    if (content === defaultResponse) {
        traceWarning('Failed to Kernel info in a timely manner, defaulting to empty info!');
    } else {
        traceVerbose('Got Kernel info');
    }
    return content;
}

async function cacheKernelInfo(
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
function getCacheKernelInfo(storage: Memento, kernelConnection: KernelConnectionMetadata) {
    if (!isRemoteConnection(kernelConnection)) {
        return;
    }
    return storage.get<CachedKernelInfo[]>(KEY, []).find((item) => item.id === kernelConnection.id)?.info;
}
