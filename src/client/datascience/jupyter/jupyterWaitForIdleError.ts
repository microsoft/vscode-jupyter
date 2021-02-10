// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';

export class JupyterWaitForIdleError extends Error {
    constructor(message: string) {
        super(message);
        sendTelemetryEvent(Telemetry.SessionIdleTimeout);
    }
}
