// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../../platform/common/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { KernelConnectionMetadata } from '../../kernels/types';
import { Telemetry } from '../../platform/common/constants';
import { trackKernelResourceInformation } from '../../kernels/telemetry/helper';
import { sendTelemetryEvent } from '../../telemetry';

export async function sendKernelListTelemetry(
    resource: Resource,
    kernels: KernelConnectionMetadata[],
    stopWatch?: StopWatch
) {
    const counters = {
        kernelSpecCount: 0,
        localKernelSpecCount: 0,
        remoteKernelSpecCount: 0,
        kernelInterpreterCount: 0,
        kernelLiveCount: 0,
        condaEnvsSharingSameInterpreter: 0
    };
    kernels.forEach((item) => {
        switch (item.kind) {
            case 'connectToLiveRemoteKernel':
                counters.kernelLiveCount += 1;
                break;
            case 'startUsingRemoteKernelSpec':
                counters.localKernelSpecCount += 1;
                counters.kernelSpecCount += 1;
                break;
            case 'startUsingLocalKernelSpec':
                counters.remoteKernelSpecCount += 1;
                counters.kernelSpecCount += 1;
                break;
            case 'startUsingPythonInterpreter': {
                counters.kernelInterpreterCount += 1;
                break;
            }
            default:
                break;
        }
    });
    await trackKernelResourceInformation(resource, counters);
    if (stopWatch) {
        sendTelemetryEvent(Telemetry.KernelCount, { duration: stopWatch.elapsedTime, ...counters });
    }
}
