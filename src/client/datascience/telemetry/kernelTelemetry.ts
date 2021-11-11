// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Resource } from '../../common/types';
import { StopWatch } from '../../common/utils/stopWatch';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { Telemetry } from '../constants';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from './telemetry';

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
    const uniqueCondaInterpreterPaths = new Set<string>();
    kernels.forEach((item) => {
        switch (item.kind) {
            case 'connectToLiveKernel':
                counters.kernelLiveCount += 1;
                break;
            case 'startUsingKernelSpec':
                counters.kernelSpecCount += 1;
                break;
            case 'startUsingPythonInterpreter': {
                counters.kernelInterpreterCount += 1;
                // Sometimes users can have different conda environments but with the same base executable.
                // This happens when not using the `python` argument when creating environments.
                // Tody we don't support such environments, lets see if people are using these, if they are then
                // We know kernels will not start correctly for those environments (even if started, packages might not be located correctly).
                if (item.interpreter.envType === EnvironmentType.Conda) {
                    if (uniqueCondaInterpreterPaths.has(item.interpreter.path)) {
                        counters.condaEnvsSharingSameInterpreter += 1;
                    } else {
                        uniqueCondaInterpreterPaths.add(item.interpreter.path);
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
