// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { env } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { setSharedProperty } from '../../telemetry';

const amlComputeRemoteName = 'amlext';

/**
 * Tracks whether or not the extension host is running on an aml compute.
 */
@injectable()
export class AmlComputeContext implements IExtensionSyncActivationService {
    constructor() {
        setSharedProperty('isamlcompute', this.isAmlCompute ? 'true' : 'false');
    }
    public get isAmlCompute() {
        return env.remoteName === amlComputeRemoteName;
    }
    public activate() {
        // noop
    }
}
