// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';

export const IEnvironmentActivationService = Symbol('IEnvironmentActivationService');
export interface IEnvironmentActivationService {
    getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter: PythonEnvironment,
        allowExceptions?: boolean
    ): Promise<NodeJS.ProcessEnv | undefined>;
}
