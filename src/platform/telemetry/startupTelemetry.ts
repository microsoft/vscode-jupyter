// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isTestExecution } from '../common/constants';
import { traceError } from '../logging';
import { sendTelemetryEvent } from '.';
import { EventName } from './constants';
import { workspace } from 'vscode';

interface IStopWatch {
    elapsedTime: number;
}

export async function sendStartupTelemetry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activatedPromise: Promise<any>,
    durations: {
        workspaceFolderCount: number;
        totalActivateTime: number;
        codeLoadingTime: number;
        startActivateTime: number;
        endActivateTime: number;
    },
    stopWatch: IStopWatch
) {
    if (isTestExecution()) {
        return;
    }

    try {
        await activatedPromise;
        durations.totalActivateTime = stopWatch.elapsedTime;
        await updateActivationTelemetryProps(durations);
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations);
    } catch (ex) {
        traceError('sendStartupTelemetry() failed.', ex);
    }
}

export async function sendErrorTelemetry(
    ex: Error,
    durations: {
        workspaceFolderCount: number;
        totalActivateTime: number;
        codeLoadingTime: number;
    }
) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let props: any = {};
        try {
            await updateActivationTelemetryProps(durations);
        } catch (ex) {
            traceError('getActivationTelemetryProps() failed.', ex);
        }
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations, props, ex);
    } catch (exc2) {
        traceError('sendErrorTelemetry() failed.', exc2);
    }
}

async function updateActivationTelemetryProps(durations: { workspaceFolderCount: number }) {
    // eslint-disable-next-line
    // TODO: Not all of this data is showing up in the database...
    // eslint-disable-next-line
    // TODO: If any one of these parts fails we send no info.  We should
    // be able to partially populate as much as possible instead
    // (through granular try-catch statements).
    const workspaceFolderCount = workspace.workspaceFolders?.length ?? 0;
    durations.workspaceFolderCount = workspaceFolderCount;
}
