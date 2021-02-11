// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from '../../common/errors/types';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';

export class JupyterWaitForIdleError extends BaseError {
    constructor(message: string) {
        super('timeout', message);
        sendTelemetryEvent(Telemetry.SessionIdleTimeout);
    }
}
