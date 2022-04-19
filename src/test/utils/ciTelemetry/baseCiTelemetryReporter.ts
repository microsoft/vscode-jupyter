/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';

export interface AppenderData {
    properties?: RawTelemetryEventProperties;
    measurements?: TelemetryEventMeasurements;
}
export interface ITelemetryAppender {
    logEvent(eventName: string, data?: AppenderData): void;
    logException(exception: Error, data?: AppenderData): void;
    flush(): void | Promise<void>;
    instantiateAppender(): void;
}

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

export class BaseTelemetryReporter {
    private userOptIn = true;
    private errorOptIn = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _extension: vscode.Extension<any> | undefined;

    constructor(
        private extensionId: string,
        private extensionVersion: string,
        private telemetryAppender: ITelemetryAppender,
        private osShim: { release: string; platform: string; architecture: string },
        private firstParty: boolean
    ) {}

    /**
     * Given a remoteName ensures it is in the list of valid ones
     * @param remoteName The remotename
     * @returns The "cleaned" one
     */
    private cleanRemoteName(remoteName?: string): string {
        if (!remoteName) {
            return 'none';
        }

        let ret = 'other';
        // Allowed remote authorities
        ['ssh-remote', 'dev-container', 'attached-container', 'wsl', 'codespaces'].forEach((res: string) => {
            if (remoteName!.indexOf(`${res}`) === 0) {
                ret = res;
            }
        });

        return ret;
    }

    /**
     * Retrieves the current extension based on the extension id
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private get extension(): vscode.Extension<any> | undefined {
        if (this._extension === undefined) {
            this._extension = vscode.extensions.getExtension(this.extensionId);
        }

        return this._extension;
    }

    /**
     * Given an object and a callback creates a clone of the object and modifies it according to the callback
     * @param obj The object to clone and modify
     * @param change The modifying function
     * @returns A new changed object
     */
    private cloneAndChange(
        obj?: { [key: string]: string },
        change?: (key: string, val: string) => string
    ): { [key: string]: string } | undefined {
        if (obj === null || typeof obj !== 'object') return obj;
        if (typeof change !== 'function') return obj;

        const ret: { [key: string]: string } = {};
        for (const key of Object.keys(obj)) {
            ret[key] = change(key, obj[key]!);
        }

        return ret;
    }

    /**
     * Whether or not it is safe to send error telemetry
     */
    private shouldSendErrorTelemetry(): boolean {
        if (this.errorOptIn === false) {
            return false;
        }

        if (this.firstParty) {
            // Don't collect errors from unknown remotes
            if (vscode.env.remoteName && this.cleanRemoteName(vscode.env.remoteName) === 'other') {
                return false;
            }

            return true;
        }
        return true;
    }

    // __GDPR__COMMON__ "common.os" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.nodeArch" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.platformversion" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.extname" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.extversion" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.vscodemachineid" : { "endPoint": "MacAddressHash", "classification": "EndUserPseudonymizedInformation", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.vscodesessionid" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.vscodeversion" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.uikind" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.remotename" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.isnewappinstall" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    // __GDPR__COMMON__ "common.product" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    private getCommonProperties(): TelemetryEventProperties {
        const commonProperties = Object.create(null);
        commonProperties['common.os'] = this.osShim.platform;
        commonProperties['common.nodeArch'] = this.osShim.architecture;
        commonProperties['common.platformversion'] = (this.osShim.release || '').replace(
            /^(\d+)(\.\d+)?(\.\d+)?(.*)/,
            '$1$2$3'
        );
        commonProperties['common.extname'] = this.extensionId;
        commonProperties['common.extversion'] = this.extensionVersion;
        if (vscode && vscode.env) {
            commonProperties['common.vscodemachineid'] = vscode.env.machineId;
            commonProperties['common.vscodesessionid'] = vscode.env.sessionId;
            commonProperties['common.vscodeversion'] = vscode.version;
            commonProperties['common.isnewappinstall'] = vscode.env.isNewAppInstall
                ? vscode.env.isNewAppInstall.toString()
                : 'false';
            commonProperties['common.product'] = vscode.env.appHost;

            switch (vscode.env.uiKind) {
                case vscode.UIKind.Web:
                    commonProperties['common.uikind'] = 'web';
                    break;
                case vscode.UIKind.Desktop:
                    commonProperties['common.uikind'] = 'desktop';
                    break;
                default:
                    commonProperties['common.uikind'] = 'unknown';
            }

            commonProperties['common.remotename'] = this.cleanRemoteName(vscode.env.remoteName);
        }
        return commonProperties;
    }

    /**
     * Given an error stack cleans up the file paths within
     * @param stack The stack to clean
     * @param anonymizeFilePaths Whether or not to clean the file paths or anonymize them as well
     * @returns The cleaned stack
     */
    private anonymizeFilePaths(stack?: string, anonymizeFilePaths?: boolean): string {
        let result: RegExpExecArray | null | undefined;
        if (stack === undefined || stack === null) {
            return '';
        }

        const cleanupPatterns = [];
        if (vscode.env.appRoot !== '') {
            cleanupPatterns.push(new RegExp(vscode.env.appRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
        }
        if (this.extension) {
            cleanupPatterns.push(new RegExp(this.extension.extensionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
        }

        let updatedStack = stack;

        if (anonymizeFilePaths) {
            const cleanUpIndexes: [number, number][] = [];
            for (const regexp of cleanupPatterns) {
                while ((result = regexp.exec(stack))) {
                    if (!result) {
                        break;
                    }
                    cleanUpIndexes.push([result.index, regexp.lastIndex]);
                }
            }

            const nodeModulesRegex = /^[\\/]?(node_modules|node_modules\.asar)[\\/]/;
            const fileRegex = /(file:\/\/)?([a-zA-Z]:(\\\\|\\|\/)|(\\\\|\\|\/))?([\w-._]+(\\\\|\\|\/))+[\w-._]*/g;
            let lastIndex = 0;
            updatedStack = '';

            while ((result = fileRegex.exec(stack))) {
                if (!result) {
                    break;
                }
                // Anoynimize user file paths that do not need to be retained or cleaned up.
                if (
                    result[0] &&
                    !nodeModulesRegex.test(result[0]) &&
                    cleanUpIndexes.every(([x, y]) => result!.index < x || result!.index >= y)
                ) {
                    updatedStack += stack.substring(lastIndex, result.index) + '<REDACTED: user-file-path>';
                    lastIndex = fileRegex.lastIndex;
                }
            }
            if (lastIndex < stack.length) {
                updatedStack += stack.substr(lastIndex);
            }
        }

        // sanitize with configured cleanup patterns
        for (const regexp of cleanupPatterns) {
            updatedStack = updatedStack.replace(regexp, '');
        }
        return updatedStack;
    }

    private removePropertiesWithPossibleUserInfo(
        properties: TelemetryEventProperties | undefined
    ): TelemetryEventProperties | undefined {
        if (typeof properties !== 'object') {
            return;
        }
        const cleanedObject = Object.create(null);
        // Loop through key and values of the properties object
        for (const key of Object.keys(properties)) {
            const value = properties[key];
            // If for some reason it is undefined we skip it (this shouldn't be possible);
            if (!value) {
                continue;
            }

            // Regex which matches @*.site
            const emailRegex = /@[a-zA-Z0-9-.]+/;
            const secretRegex = /(key|token|sig|signature|password|passwd|pwd|android:value)[^a-zA-Z0-9]/;
            // last +? is lazy as a microoptimization since we don't care about the full value
            const tokenRegex = /xox[pbaors]-[a-zA-Z0-9]+-[a-zA-Z0-9-]+?/;

            // Check for common user data in the telemetry events
            if (secretRegex.test(value.toLowerCase())) {
                cleanedObject[key] = '<REDACTED: secret>';
            } else if (emailRegex.test(value)) {
                cleanedObject[key] = '<REDACTED: email>';
            } else if (tokenRegex.test(value)) {
                cleanedObject[key] = '<REDACTED: token>';
            } else {
                cleanedObject[key] = value;
            }
        }
        return cleanedObject;
    }

    /**
     * Given an event name, some properties, and measurements sends a telemetry event.
     * Properties are sanitized on best-effort basis to remove sensitive data prior to sending.
     * @param eventName The name of the event
     * @param properties The properties to send with the event
     * @param measurements The measurements (numeric values) to send with the event
     */
    public sendTelemetryEvent(
        eventName: string,
        properties?: TelemetryEventProperties,
        measurements?: TelemetryEventMeasurements
    ): void {
        if (this.userOptIn && eventName !== '') {
            properties = { ...properties, ...this.getCommonProperties() };
            const cleanProperties = this.cloneAndChange(properties, (_key: string, prop: string) =>
                this.anonymizeFilePaths(prop, this.firstParty)
            );
            this.telemetryAppender.logEvent(`${this.extensionId}/${eventName}`, {
                properties: this.removePropertiesWithPossibleUserInfo(cleanProperties),
                measurements: measurements
            });
        }
    }

    /**
     * Given an event name, some properties, and measurements sends a raw (unsanitized) telemetry event
     * @param eventName The name of the event
     * @param properties The properties to send with the event
     * @param measurements The measurements (numeric values) to send with the event
     */
    public sendRawTelemetryEvent(
        eventName: string,
        properties?: RawTelemetryEventProperties,
        measurements?: TelemetryEventMeasurements
    ): void {
        if (eventName !== '') {
            properties = { ...properties, ...this.getCommonProperties() };
            this.telemetryAppender.logEvent(`${this.extensionId}/${eventName}`, { properties, measurements });
        }
    }

    /**
     * Given an event name, some properties, and measurements sends an error event
     * @param eventName The name of the event
     * @param properties The properties to send with the event
     * @param measurements The measurements (numeric values) to send with the event
     * @param errorProps If not present then we assume all properties belong to the error prop and will be anonymized
     */
    public sendTelemetryErrorEvent(
        eventName: string,
        properties?: { [key: string]: string },
        measurements?: { [key: string]: number },
        errorProps?: string[]
    ): void {
        if (this.errorOptIn && eventName !== '') {
            // always clean the properties if first party
            // do not send any error properties if we shouldn't send error telemetry
            // if we have no errorProps, assume all are error props
            properties = { ...properties, ...this.getCommonProperties() };
            const cleanProperties = this.cloneAndChange(properties, (key: string, prop: string) => {
                if (this.shouldSendErrorTelemetry()) {
                    return this.anonymizeFilePaths(prop, this.firstParty);
                }

                if (errorProps === undefined || errorProps.indexOf(key) !== -1) {
                    return 'REDACTED';
                }

                return this.anonymizeFilePaths(prop, this.firstParty);
            });
            this.telemetryAppender.logEvent(`${this.extensionId}/${eventName}`, {
                properties: this.removePropertiesWithPossibleUserInfo(cleanProperties),
                measurements: measurements
            });
        }
    }

    /**
     * Given an error, properties, and measurements. Sends an exception event
     * @param error The error to send
     * @param properties The properties to send with the event
     * @param measurements The measurements (numeric values) to send with the event
     */
    public sendTelemetryException(
        error: Error,
        properties?: TelemetryEventProperties,
        measurements?: TelemetryEventMeasurements
    ): void {
        if (this.shouldSendErrorTelemetry() && this.errorOptIn && error) {
            properties = { ...properties, ...this.getCommonProperties() };
            const cleanProperties = this.cloneAndChange(properties, (_key: string, prop: string) =>
                this.anonymizeFilePaths(prop, this.firstParty)
            );
            // Also run the error stack through the anonymizer
            if (error.stack) {
                error.stack = this.anonymizeFilePaths(error.stack, this.firstParty);
            }
            this.telemetryAppender.logException(error, {
                properties: this.removePropertiesWithPossibleUserInfo(cleanProperties),
                measurements: measurements
            });
        }
    }

    /**
     * Disposes of the telemetry reporter
     */
    public async dispose(): Promise<void> {
        await this.telemetryAppender.flush();
    }
}
