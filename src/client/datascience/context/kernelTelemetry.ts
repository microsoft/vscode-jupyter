// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Resource } from '../../common/types';
import { StopWatch } from '../../common/utils/stopWatch';
import { Telemetry } from '../constants';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { sendKernelTelemetryEvent } from './telemetry';

export function sendKernelListTelemetry(
    resource: Resource,
    kernels: { selection: KernelConnectionMetadata }[],
    stopWatch: StopWatch
) {
    let counters = {
        kernelSpecs: 0,
        interpreters: 0,
        liveKernels: 0
    };
    kernels.forEach((item) => {
        switch (item.selection.kind) {
            case 'connectToLiveKernel':
                counters.liveKernels += 1;
                break;
            case 'startUsingDefaultKernel':
            case 'startUsingKernelSpec':
                counters.kernelSpecs += 1;
                break;
            case 'startUsingPythonInterpreter':
                counters.interpreters += 1;
                break;
            default:
                break;
        }
    });
    sendKernelTelemetryEvent(resource, Telemetry.KernelCount, stopWatch.elapsedTime, counters);
}
