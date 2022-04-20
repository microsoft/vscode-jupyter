/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { TelemetryClient } from 'applicationinsights';
import * as os from 'os';
import { AppinsightsKey } from '../../../platform/common/constants.node';
import * as vscode from 'vscode';
/**
 * An isolated wrapper for an Application Insights client that is specifically for sending telemetry during CI jobs.
 * This won't run on a users machine, so there is no need to check for opt-in status.
 */
export class CiTelemetryReporter {
    private telemetryClient: TelemetryClient | undefined;

    constructor(private readonly extensionId: string, private readonly extensionVersion: string) {}

    public async initialize() {
        let appInsightsClient: TelemetryClient | undefined;
        try {
            const appInsights = await import('applicationinsights');
            //check if another instance is already initialized
            if (appInsights.defaultClient) {
                appInsightsClient = new appInsights.TelemetryClient(AppinsightsKey);
                // no other way to enable offline mode
                appInsightsClient.channel.setUseDiskRetryCaching(true);
            } else {
                appInsights
                    .setup(AppinsightsKey)
                    .setAutoCollectRequests(false)
                    .setAutoCollectPerformance(false)
                    .setAutoCollectExceptions(false)
                    .setAutoCollectDependencies(false)
                    .setAutoDependencyCorrelation(false)
                    .setAutoCollectConsole(false)
                    .setAutoCollectHeartbeat(false)
                    .setUseDiskRetryCaching(true)
                    .start();
                appInsightsClient = appInsights.defaultClient;
            }
            if (vscode && vscode.env) {
                appInsightsClient.context.tags[appInsightsClient.context.keys.userId] = vscode.env.machineId;
                appInsightsClient.context.tags[appInsightsClient.context.keys.sessionId] = vscode.env.sessionId;
                appInsightsClient.context.tags[appInsightsClient.context.keys.cloudRole] = vscode.env.appName;
                appInsightsClient.context.tags[appInsightsClient.context.keys.cloudRoleInstance] = vscode.env.appName;
            }
            // change the endpoint for the Asimov key

            appInsightsClient.config.endpointUrl = 'https://vortex.data.microsoft.com/collect/v1';
        } catch (e) {
            return Promise.reject('Failed to initialize app insights!\n' + e.message);
        }

        this.telemetryClient = appInsightsClient;
    }

    public sendTelemetryEvent(
        eventName: string,
        properties: Record<string, string>,
        measures?: Record<string, number>
    ) {
        let eventNameSent = 'ms-toolsai.jupyter/' + eventName
        let allProperties = { ...this.getCommonProperties(), ...properties };
        try {
            this.telemetryClient?.trackEvent({
                name: eventNameSent,
                properties: allProperties,
                measurements: measures
            });
        } catch (e) {
            throw new Error('Failed to log event to app insights!\n' + e.message);
        }
    }

    public async flush() {
        await this.telemetryClient?.flush();
    }

    private getCommonProperties(): Record<string, string> {
        const commonProperties = Object.create(null);
        commonProperties['common.os'] = os.platform();
        commonProperties['common.nodeArch'] = os.arch();
        commonProperties['common.platformversion'] = os.release().replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3');
        commonProperties['common.extname'] = this.extensionId;
        commonProperties['common.extversion'] = this.extensionVersion;
        if (vscode && vscode.env) {
            commonProperties['common.vscodemachineid'] = vscode.env.machineId;
            commonProperties['common.vscodesessionid'] = vscode.env.sessionId;
            commonProperties['common.vscodeversion'] = vscode.version;
            commonProperties['common.product'] = vscode.env.appHost;
        }
        return commonProperties;
    }
}
