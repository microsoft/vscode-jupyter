// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseKernelError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { KernelConnectionMetadata } from '../../../kernels/types';

export class JupyterWaitForIdleError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super('timeout', DataScience.jupyterLaunchTimedOut(), kernelConnectionMetadata);
        sendTelemetryEvent(Telemetry.SessionIdleTimeout);
    }
}
