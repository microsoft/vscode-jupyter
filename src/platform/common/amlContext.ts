// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { env } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { setSharedProperty } from '../telemetry';

const amlComputeRemoteName = 'amlext';

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
