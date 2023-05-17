// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Memento } from 'vscode';
import { noop } from './utils/misc';

export async function removeOldCachedItems(globalState: Memento): Promise<void> {
    await Promise.all(
        [
            'currentServerHash',
            'connectToLocalKernelsOnly',
            'JUPYTER_LOCAL_KERNELSPECS',
            'JUPYTER_LOCAL_KERNELSPECS_V1',
            'JUPYTER_LOCAL_KERNELSPECS_V2',
            'JUPYTER_LOCAL_KERNELSPECS_V3',
            'JUPYTER_REMOTE_KERNELSPECS',
            'JUPYTER_REMOTE_KERNELSPECS_V1',
            'JUPYTER_REMOTE_KERNELSPECS_V2',
            'JUPYTER_REMOTE_KERNELSPECS_V3',
            'JUPYTER_LOCAL_KERNELSPECS_V4',
            'LOCAL_KERNEL_SPECS_CACHE_KEY_V_2022_10',
            'LOCAL_KERNEL_PYTHON_AND_RELATED_SPECS_CACHE_KEY_V_2022_10'
        ]
            .filter((key) => globalState.get(key, undefined) !== undefined)
            .map((key) => globalState.update(key, undefined).then(noop, noop))
    );
}
