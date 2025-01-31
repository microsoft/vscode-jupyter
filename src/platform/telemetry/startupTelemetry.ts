// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isTestExecution } from '../common/constants';
import { logger } from '../logging';
import { sendTelemetryEvent } from '.';
import { EventName } from './constants';
import { workspace } from 'vscode';

export const startupDurations: {
    workspaceFolderCount: number;
    totalActivateTime: number;
    codeLoadingTime: number;
    startActivateTime: number;
    endActivateTime: number;
} = { codeLoadingTime: 0, endActivateTime: 0, startActivateTime: 0, totalActivateTime: 0, workspaceFolderCount: 0 };

export function sendStartupTelemetry(
    durations: {
        workspaceFolderCount: number;
        totalActivateTime: number;
        codeLoadingTime: number;
        startActivateTime: number;
        endActivateTime: number;
    },
    stopWatch: {
        elapsedTime: number;
    }
) {
    if (isTestExecution()) {
        return;
    }

    try {
        durations.endActivateTime = stopWatch.elapsedTime;
        durations.totalActivateTime = stopWatch.elapsedTime;
        Object.assign(startupDurations, durations);
        updateActivationTelemetryProps(durations);
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations);
    } catch (ex) {
        logger.error('sendStartupTelemetry() failed.', ex);
    }
}

export function sendErrorTelemetry(
    ex: Error,
    durations: {
        workspaceFolderCount: number;
        totalActivateTime: number;
        endActivateTime: number;
        codeLoadingTime: number;
    },
    stopWatch: {
        elapsedTime: number;
    }
) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let props: any = {};
        durations.endActivateTime = stopWatch.elapsedTime;
        durations.totalActivateTime = stopWatch.elapsedTime;
        Object.assign(startupDurations, durations);
        updateActivationTelemetryProps(durations);
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations, props, ex);
    } catch (exc2) {
        logger.error('sendErrorTelemetry() failed.', exc2);
    }
}

function updateActivationTelemetryProps(durations: { workspaceFolderCount: number }) {
    // eslint-disable-next-line
    // TODO: Not all of this data is showing up in the database...
    // eslint-disable-next-line
    // TODO: If any one of these parts fails we send no info.  We should
    // be able to partially populate as much as possible instead
    // (through granular try-catch statements).
    const workspaceFolderCount = workspace.workspaceFolders?.length ?? 0;
    durations.workspaceFolderCount = workspaceFolderCount;
}
