// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Resource } from '../../common/types';
import { StopWatch } from '../../common/utils/stopWatch';
import { Telemetry } from '../constants';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from './telemetry';

export function sendKernelListTelemetry(
    resource: Resource,
    kernels: { selection: KernelConnectionMetadata }[],
    stopWatch: StopWatch
) {
    let counters = {
        kernelSpecCount: 0,
        kernelInterpreterCount: 0,
        kernelLiveCount: 0
    };
    kernels.forEach((item) => {
        switch (item.selection.kind) {
            case 'connectToLiveKernel':
                counters.kernelLiveCount += 1;
                break;
            case 'startUsingDefaultKernel':
            case 'startUsingKernelSpec':
                counters.kernelSpecCount += 1;
                break;
            case 'startUsingPythonInterpreter':
                counters.kernelInterpreterCount += 1;
                break;
            default:
                break;
        }
    });
    trackKernelResourceInformation(resource, counters);
    sendKernelTelemetryEvent(resource, Telemetry.KernelCount, stopWatch.elapsedTime, counters);
}
