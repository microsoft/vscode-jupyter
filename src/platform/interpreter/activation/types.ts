// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { Resource } from '../../common/types';

export const IEnvironmentActivationService = Symbol('IEnvironmentActivationService');
export interface IEnvironmentActivationService {
    getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter: { id: string },
        token?: CancellationToken
    ): Promise<NodeJS.ProcessEnv | undefined>;
}
