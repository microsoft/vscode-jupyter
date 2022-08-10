// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { env } from 'vscode';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { setSharedProperty } from '../../telemetry';

const amlComputeRemoteName = 'amlext';

/**
 * Tracks whether or not the extension host is running on an aml compute.
 */
@injectable()
export class AmlComputeContext implements IExtensionSingleActivationService {
    constructor() {
        setSharedProperty('isamlcompute', this.isAmlCompute ? 'true' : 'false');
    }
    public get isAmlCompute() {
        return env.remoteName === amlComputeRemoteName;
    }
    public async activate(): Promise<void> {
        return;
    }
}
