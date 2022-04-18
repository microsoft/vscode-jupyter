/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export interface TelemetryEventProperties {
	readonly [key: string]: string;
}

export interface RawTelemetryEventProperties {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [key: string]: any;
}

export interface TelemetryEventMeasurements {
	readonly [key: string]: number;
}

/**
 * A replacement option for the app insights client. This allows the appender to filter out any sensitive or unnecessary information from the telemetry server.
 */
 export interface ReplacementOption {

	/**
	 * A regular expression matching any property to be removed or replaced from the telemetry server.
	 */
	lookup: RegExp;

	/**
	 * The replacement value for the property. If not present or undefined, the property will be removed.
	 */
	replacementString?: string;
}

export default class TelemetryReporter {
	/**
	 * @param extensionId The id of your extension
	 * @param extensionVersion The version of your extension
	 * @param key The app insights key
	 * @param firstParty Whether or not the telemetry is first party (i.e from Microsoft / GitHub)
	 * @param replacementOptions A list of replacement options for the app insights client. This allows the appender to filter out any sensitive or unnecessary information from the telemetry server.
	 */
	constructor(extensionId: string, extensionVersion: string, key: string, firstParty?: boolean, replacementOptions?: ReplacementOption[]);

	/**
	 * A string representation of the current level of telemetry being collected
	 */
	telemetryLevel: 'all' | 'error' | 'crash' | 'off';

	/**
	 * Sends a telemetry event with the given properties and measurements
	 * Properties are sanitized on best-effort basis to remove sensitive data prior to sending.
	 * @param eventName The name of the event
	 * @param properties The set of properties to add to the event in the form of a string key value pair
	 * @param measurements The set of measurements to add to the event in the form of a string key  number value pair
	 */
	sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;

	/**
	 * Sends a raw (unsanitized) telemetry event with the given properties and measurements
	 * @param eventName The name of the event
	 * @param properties The set of properties to add to the event in the form of a string key value pair
	 * @param measurements The set of measurements to add to the event in the form of a string key  number value pair
	 */
	sendRawTelemetryEvent(eventName: string, properties?: RawTelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;

	/**
	 * Sends a telemetry error event with the given properties, measurements, and errorProps
	 * @param eventName The name of the event
	 * @param properties The set of properties to add to the event in the form of a string key value pair
	 * @param measurements The set of measurements to add to the event in the form of a string key  number value pair
	 * @param errorProps A list of case sensitive properties to drop, if excluded we drop all properties but still send the event
	 */
	sendTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements, errorProps?: string[]): void;

	/**
	 * Sends an exception which includes the error stack, properties, and measurements
	 * @param error The error to send
	 * @param properties The set of properties to add to the event in the form of a string key value pair
	 * @param measurements The set of measurements to add to the event in the form of a string key  number value pair
	 */
	sendTelemetryException(error: Error, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;

	/**
	 * Disposes of the telemetry reporter. This flushes the remaining events and disposes of the telemetry client.
	 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	dispose(): Promise<any>;
}
