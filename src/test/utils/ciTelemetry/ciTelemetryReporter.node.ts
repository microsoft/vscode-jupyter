/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as os from 'os';
import { BaseTelemetryReporter } from './baseCiTelemetryReporter';
import { TelemetryAppender } from './TelemetryAppender';
import { appInsightsClientFactory } from './appInsightsClientFactory.node';

/**
 * An isolated wrapper for an Application Insights client that is specifically for sending telemetry during CI jobs.
 * This won't run on a users machine, so there is no need to check for opt-in status.
 */
export class CiTelemetryReporter extends BaseTelemetryReporter {
    constructor(extensionId: string, extensionVersion: string, key: string, firstParty: boolean) {
        const appender = new TelemetryAppender(key, (key) => appInsightsClientFactory(key));
        if (key && key.indexOf('AIF-') === 0) {
            firstParty = true;
        }
        super(
            extensionId,
            extensionVersion,
            appender,
            {
                release: os.release(),
                platform: os.platform(),
                architecture: os.arch()
            },
            firstParty
        );
    }
}
