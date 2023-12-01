// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../common/types';
import { SystemVariables } from '../common/variables/systemVariables.node';

import { sendTelemetryEvent } from '.';
import { EventName } from './constants';
import { Uri, workspace } from 'vscode';
import { IFileSystem } from '../common/platform/types';

let _defaultEnvFileSetting: string | undefined;
let envFileTelemetrySent = false;

export function sendFileCreationTelemetry() {
    if (shouldSendTelemetry()) {
        sendTelemetry();
    }
}

export async function sendActivationTelemetry(fileSystem: IFileSystem, resource: Resource) {
    if (shouldSendTelemetry()) {
        const systemVariables = new SystemVariables(resource, undefined);
        const envFilePath = systemVariables.resolveAny(defaultEnvFileSetting())!;
        const envFileExists = await fileSystem.exists(Uri.file(envFilePath));

        if (envFileExists) {
            sendTelemetry();
        }
    }
}

function sendTelemetry() {
    sendTelemetryEvent(EventName.ENVFILE_WORKSPACE);

    envFileTelemetrySent = true;
}

function shouldSendTelemetry(): boolean {
    return !envFileTelemetrySent;
}

function defaultEnvFileSetting() {
    if (!_defaultEnvFileSetting) {
        const section = workspace.getConfiguration('python');
        _defaultEnvFileSetting = section.inspect<string>('envFile')?.defaultValue || '';
    }

    return _defaultEnvFileSetting;
}

// Set state for tests.
export namespace EnvFileTelemetryTests {
    export function setState({ telemetrySent, defaultSetting }: { telemetrySent?: boolean; defaultSetting?: string }) {
        if (telemetrySent !== undefined) {
            envFileTelemetrySent = telemetrySent;
        }
        if (defaultEnvFileSetting !== undefined) {
            _defaultEnvFileSetting = defaultSetting;
        }
    }

    export function resetState() {
        _defaultEnvFileSetting = undefined;
        envFileTelemetrySent = false;
    }
}
