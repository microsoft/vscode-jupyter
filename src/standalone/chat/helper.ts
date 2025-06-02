// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';

export function sendLMToolCallTelemetry(toolName: string, resource: Uri) {
    // eslint-disable-next-line local-rules/dont-use-fspath
    void getTelemetrySafeHashedString(resource.fsPath).then((resourceHash) => {
        sendTelemetryEvent(Telemetry.LMToolCall, undefined, {
            toolName,
            resourceHash
        });
    });
}

export function sendConfigureNotebookToolCallTelemetry(
    resource: Uri,
    telemetry: {
        createdEnv?: boolean;
        installedPythonExtension?: boolean;
        isPython?: boolean;
    }
) {
    // eslint-disable-next-line local-rules/dont-use-fspath
    void getTelemetrySafeHashedString(resource.fsPath).then((resourceHash) => {
        sendTelemetryEvent(Telemetry.ConfigureNotebookToolCall, undefined, {
            resourceHash,
            createdEnv: telemetry.createdEnv === true,
            installedPythonExtension: telemetry.installedPythonExtension === true,
            isPython: telemetry.isPython === true
        });
    });
}
