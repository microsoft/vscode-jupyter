// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isTestExecution } from '../../platform/common/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function suppressShutdownErrors(realKernel: any) {
    // When running under a test, mark all futures as done so we
    // don't hit this problem:
    // https://github.com/jupyterlab/jupyterlab/issues/4252
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if (isTestExecution()) {
        const defaultKernel = realKernel as any; // NOSONAR
        if (defaultKernel && defaultKernel._futures) {
            const futures = defaultKernel._futures as Map<any, any>; // NOSONAR
            if (futures.forEach) {
                // Requires for unit tests when things are mocked.
                futures.forEach((f) => {
                    if (f._status !== undefined) {
                        f._status |= 4;
                    }
                });
            }
        }
        if (defaultKernel && defaultKernel._reconnectLimit) {
            defaultKernel._reconnectLimit = 0;
        }
    }
}
