// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { EnvironmentType } from '../../pythonEnvironments/info';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';

let connection: KernelConnectionMetadata;
export type ResourceSpecificTelemetryProperties = Partial<{
    resourceType: 'notebook' | 'interactive';
    /**
     * Whether this resource is using the active Python interpreter or not.
     */
    isUsingActiveInterpreter?: boolean;
    /**
     * Found plenty of issues when starting kernels with conda, hence useful to capture this info.
     */
    pythonEnvironmentType?: EnvironmentType;
    /**
     * A key, so that rest of the information is tied to this. (hash)
     */
    pythonEnvironmentPath?: string;
    /**
     * Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)
     */
    pythonEnvironmentVersion?: string;
    /**
     * Total number of python environments.
     */
    pythonEnvironmentCount?: number;
    /**
     * Whether kernel was started using kernel spec, interpreter, etc.
     */
    kernelConnectionType?: typeof connection.kind;
    /**
     * Language of the kernel connection.
     */
    kernelLanguage: string;
    /**
     * This number gets reset after we attempt a restart or change kernel.
     */
    interruptCount?: number;
    /**
     * This number gets reset after change the kernel.
     */
    restartCount?: number;
    /**
     * Number of times starting the kernel failed.
     */
    startFailureCount?: number;
    /**
     * Number of times the kernel was changed.
     */
    switchKernelCount?: number;
    /**
     * Total number of kernel specs in the kernel spec list.
     */
    kernelSpecCount: number;
    /**
     * Total number of interpreters in the kernel spec list.
     */
    kernelInterpreterCount: number;
    /**
     * Total number of live kernels in the kernel spec list.
     */
    kernelLiveCount: number;
}>;
