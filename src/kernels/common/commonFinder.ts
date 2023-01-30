// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Memento } from 'vscode';
import { noop } from '../../platform/common/utils/misc';

// Two cache keys so we can get local and remote separately
export const RemoteKernelSpecsCacheKey = 'JUPYTER_REMOTE_KERNELSPECS_V4';

export async function removeOldCachedItems(globalState: Memento): Promise<void> {
    await Promise.all(
        [
            'JUPYTER_LOCAL_KERNELSPECS',
            'JUPYTER_LOCAL_KERNELSPECS_V1',
            'JUPYTER_LOCAL_KERNELSPECS_V2',
            'JUPYTER_LOCAL_KERNELSPECS_V3',
            'JUPYTER_REMOTE_KERNELSPECS',
            'JUPYTER_REMOTE_KERNELSPECS_V1',
            'JUPYTER_REMOTE_KERNELSPECS_V2',
            'JUPYTER_REMOTE_KERNELSPECS_V3',
            'JUPYTER_LOCAL_KERNELSPECS_V4'
        ]
            .filter((key) => RemoteKernelSpecsCacheKey !== key) // Exclude latest cache key
            .filter((key) => globalState.get(key, undefined) !== undefined)
            .map((key) => globalState.update(key, undefined).then(noop, noop))
    );
}
