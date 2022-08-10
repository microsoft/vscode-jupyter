// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { getTelemetrySafeLanguage } from '../../platform/telemetry/helpers';

export function sendNotebookOrKernelLanguageTelemetry(
    telemetryEvent: Telemetry.SwitchToExistingKernel | Telemetry.NotebookLanguage,
    language?: string
) {
    language = getTelemetrySafeLanguage(language);
    sendTelemetryEvent(telemetryEvent, undefined, { language });
}
