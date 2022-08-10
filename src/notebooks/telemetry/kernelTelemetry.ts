// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../../platform/common/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { KernelConnectionMetadata } from '../../kernels/types';
import { Telemetry } from '../../platform/common/constants';
import { sendKernelTelemetryEvent } from '../../kernels/telemetry/sendKernelTelemetryEvent';
import { trackKernelResourceInformation } from '../../kernels/telemetry/helper';
import { ResourceSet } from '../../platform/vscode-path/map';

export function sendKernelListTelemetry(
    resource: Resource,
    kernels: KernelConnectionMetadata[],
    stopWatch?: StopWatch
) {
    const counters = {
        kernelSpecCount: 0,
        kernelInterpreterCount: 0,
        kernelLiveCount: 0,
        condaEnvsSharingSameInterpreter: 0
    };
    const uniqueCondaInterpreterPaths = new ResourceSet();
    kernels.forEach((item) => {
        switch (item.kind) {
            case 'connectToLiveRemoteKernel':
                counters.kernelLiveCount += 1;
                break;
            case 'startUsingRemoteKernelSpec':
            case 'startUsingLocalKernelSpec':
                counters.kernelSpecCount += 1;
                break;
            case 'startUsingPythonInterpreter': {
                counters.kernelInterpreterCount += 1;
                // Sometimes users can have different conda environments but with the same base executable.
                // This happens when not using the `python` argument when creating environments.
                // Tody we don't support such environments, lets see if people are using these, if they are then
                // We know kernels will not start correctly for those environments (even if started, packages might not be located correctly).
                if (item.interpreter.envType === EnvironmentType.Conda) {
                    if (uniqueCondaInterpreterPaths.has(item.interpreter.uri)) {
                        counters.condaEnvsSharingSameInterpreter += 1;
                    } else {
                        uniqueCondaInterpreterPaths.add(item.interpreter.uri);
                    }
                }
                break;
            }
            default:
                break;
        }
    });
    trackKernelResourceInformation(resource, counters);
    if (stopWatch) {
        sendKernelTelemetryEvent(resource, Telemetry.KernelCount, stopWatch.elapsedTime, counters);
    }
}
