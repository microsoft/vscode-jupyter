// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WrappedError } from '../../platform/errors/types';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
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

/**
 * Exception raised when starting a Jupyter Session fails.
 *
 * Cause:
 * Jupyter [session](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.session.html) was not created for some reason
 * by the [SessionManager](https://jupyterlab.readthedocs.io/en/stable/api/classes/services.sessionmanager-1.html)
 *
 * Handled by:
 * User should be shown this in the executing cell (if there is one), otherwise a notification will pop up. User is asked to look in the output
 * tab for more information (hopefully the reason the SessionManager failed).
 */
export class JupyterSessionStartError extends WrappedError {
    constructor(originalException: Error) {
        super(originalException.message, originalException);
        sendTelemetryEvent(Telemetry.StartSessionFailedJupyter, undefined, undefined, originalException);
    }
}
