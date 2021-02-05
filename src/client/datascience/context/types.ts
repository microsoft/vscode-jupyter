// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { EnvironmentType } from '../../pythonEnvironments/info';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';

let connection: KernelConnectionMetadata;
export type ResourceSpecificTelemetryProperties = {
    resourceType: 'notebook' | 'interactive';
    // Found plenty of issues when starting kernels with conda, hence useful to capture this info.
    pythonEnvironmentType?: EnvironmentType;
    // A key, so that rest of the information is tied to this.
    pythonEnvironmentPath?: string;
    // Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)
    pythonEnvironmentVersion?: string;
    kernelWasAutoStarted?: boolean;
    // Whether kernel was started using kernel spec, interpreter, etc.
    kernelConnectionType?: typeof connection.kind;
};
