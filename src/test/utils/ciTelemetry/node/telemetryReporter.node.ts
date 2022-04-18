/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import type { TelemetryClient } from "applicationinsights";
import { AppenderData, BaseTelemetryReporter } from "../common/baseTelemetryReporter";
import { BaseTelemetryAppender, BaseTelemetryClient } from "../common/baseTelemetryAppender";

/**
 * A factory function which creates a telemetry client to be used by an appender to send telemetry in a node application.
 *
 * @param key The app insights key
 * @param replacementOptions Optional list of {@link ReplacementOption replacements} to apply to the telemetry client. This allows
 * the appender to filter out any sensitive or unnecessary information from the telemetry server.
 *
 * @returns A promise which resolves to the telemetry client or rejects upon error
 */
const appInsightsClientFactory = async (key: string): Promise<BaseTelemetryClient> => {
	let appInsightsClient: TelemetryClient | undefined;
	try {
		process.env["APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL"] = "1";
		const appInsights = await import("applicationinsights");
		//check if another instance is already initialized
		if (appInsights.defaultClient) {
			appInsightsClient = new appInsights.TelemetryClient(key);
			// no other way to enable offline mode
			appInsightsClient.channel.setUseDiskRetryCaching(true);
		} else {
			appInsights.setup(key)
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
		//check if it's an Asimov key to change the endpoint
		if (key && key.indexOf("AIF-") === 0) {
			appInsightsClient.config.endpointUrl = "https://vortex.data.microsoft.com/collect/v1";
		}
	} catch (e) {
		return Promise.reject("Failed to initialize app insights!\n" + e.message);
	}

	// Sets the appinsights client into a standardized form
	const telemetryClient: BaseTelemetryClient = {
		logEvent: (eventName: string, data?: AppenderData) => {
			try {
				appInsightsClient?.trackEvent({
					name: eventName,
					properties: data?.properties,
					measurements: data?.measurements
				});
			} catch (e) {
				throw new Error("Failed to log event to app insights!\n" + e.message);
			}
		},
		logException: (exception: Error, data?: AppenderData) => {
			try {
				appInsightsClient?.trackException({
					exception,
					properties: data?.properties,
					measurements: data?.measurements
				});
			} catch(e) {
				throw new Error("Failed to log exception to app insights!\n" + e.message);
			}
		},
		flush: async () => {
			try {
				appInsightsClient?.flush();
			} catch(e) {
				throw new Error("Failed to flush app insights!\n" + e.message);
			}
		}
	};
	return telemetryClient;
};

export default class TelemetryReporter extends BaseTelemetryReporter {
	constructor(extensionId: string, extensionVersion: string, key: string, firstParty: boolean) {
		const appender = new BaseTelemetryAppender(key, (key) => appInsightsClientFactory(key));
		if (key && key.indexOf("AIF-") === 0) {
			firstParty = true;
		}
		super(extensionId, extensionVersion, appender, {
			release: os.release(),
			platform: os.platform(),
			architecture: os.arch(),
		}, firstParty);
	}
}
