// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KernelConnectionMetadata } from '../../kernels/types';
import { Telemetry } from '../../platform/common/constants';
import { sendTelemetryEvent } from '../../telemetry';

export function sendKernelListTelemetry(kernels: KernelConnectionMetadata[]) {
    const counters = {
        kernelSpecCount: 0,
        localKernelSpecCount: 0,
        remoteKernelSpecCount: 0,
        kernelInterpreterCount: 0,
        kernelLiveCount: 0
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
    sendTelemetryEvent(Telemetry.KernelCount, { ...counters });
}
