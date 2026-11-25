// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { IKernelSession, KernelConnectionMetadata, isRemoteConnection } from './types';
import { CancellationToken, Memento } from 'vscode';
import { logger } from '../platform/logging';
import { noop } from '../platform/common/utils/misc';
import { sleep } from '../platform/common/utils/async';
import { Cancellation, raceCancellationError } from '../platform/common/cancellation';
import { JupyterInvalidKernelError } from './errors/jupyterInvalidKernelError';

type CachedKernelInfo = {
    id: string;
    info: KernelMessage.IReplyErrorContent | KernelMessage.IReplyAbortContent | KernelMessage.IInfoReply | undefined;
    // Time when this was stored in mememto.
    age: number;
};
const KEY = 'KERNEL_INFO';
const CACHE_EXPIRY_IN_MS = 1000 * 60 * 60 * 24 * 2;

/**
 * Requests kernel info, returning it (or cached/default content) or undefined.
 *
 * @param options When supplied with a `token`, cancellation now *throws* (previously this function
 *   always resolved). Only the startup-recovery path passes a token, and its callers expect the
 *   throw; all other callers omit `options` and keep the original "never throws" behavior.
 *   `requireFresh` forces a brand-new kernel-info round-trip (ignoring any cached/pending info); it
 *   is used by the startup coordinator's readiness fence, which must confirm the live kernel rather
 *   than publish stale readiness.
 */
export async function getKernelInfo(
    session: IKernelSession,
    kernelConnectionMetadata: KernelConnectionMetadata,
    workspaceMemento: Memento,
    options?: { requireFresh: boolean; token: CancellationToken }
) {
    Cancellation.throwIfCanceled(options?.token);
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
    if (!session.kernel) {
        // The startup coordinator (requireFresh) must surface a hard failure here rather than
        // returning undefined: a missing kernel means readiness cannot be confirmed, and silently
        // returning would let startup publish a kernel that is actually gone. Other callers keep the
        // original lenient behavior and simply return.
        if (options?.requireFresh) {
            throw new JupyterInvalidKernelError(kernelConnectionMetadata);
        }
        return;
    }
    if (session.kernel?.info && !options?.requireFresh) {
        promises.push(session.kernel.info);
        session.kernel.info
            .then((content) => cacheKernelInfo(workspaceMemento, kernelConnectionMetadata, content))
            .catch(noop);
    }
    // KernelMessage.IReplyErrorContent | KernelMessage.IReplyAbortContent | KernelMessage.IInfoReply | undefined

    // Even if we might have a cached response to the kernel info, make this request.
    // We rely on this being sent always, to detect whether cells completed execution or the like
    // after reloading VS Code.
    const kernelInfoPromise = session.kernel.requestKernelInfo().then((item) => item?.content);
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
    const content = await raceCancellationError(options?.token, Promise.race(promises));
    if (content === defaultResponse) {
        logger.warn('Failed to Kernel info in a timely manner, defaulting to empty info!');
    } else {
        logger.trace('Got Kernel info');
    }
    return content;
}

async function cacheKernelInfo(
    storage: Memento,
    kernelConnection: KernelConnectionMetadata,
    info: KernelMessage.IReplyErrorContent | KernelMessage.IReplyAbortContent | KernelMessage.IInfoReply | undefined
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
