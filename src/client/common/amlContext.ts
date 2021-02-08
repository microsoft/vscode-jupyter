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
        setSharedProperty('isamlcompute', this.isAmlCompute);
    }
    public get isAmlCompute() {
        return env.remoteName === amlComputeRemoteName;
    }
    public activate(): Promise<void> {
        return Promise.resolve();
    }
}
