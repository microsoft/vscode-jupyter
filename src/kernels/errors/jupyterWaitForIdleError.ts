// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when kernel does not come back from wait for idle.
 */
export class JupyterWaitForIdleError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super('timeout', DataScience.jupyterLaunchTimedOut(), kernelConnectionMetadata);
        sendTelemetryEvent(Telemetry.SessionIdleTimeout);
    }
}
