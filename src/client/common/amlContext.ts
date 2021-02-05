// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { setSharedProperty } from '../telemetry';
import { GLOBAL_MEMENTO, IMemento } from './types';
import { noop } from './utils/misc';

const amlComputeMementoKey = 'JVSC_IS_AML_COMPUTE_INSTANCE';

@injectable()
export class AmlComputeContext implements IExtensionSingleActivationService {
    constructor(@inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento) {}

    public get isAmlCompute() {
        return this.memento.get<boolean>(amlComputeMementoKey, false) || this.isAmlComputeWorkspace();
    }
    private isAmlComputeWorkspace() {
        return typeof process.env.AZURE_EXTENSION_DIR === 'string';
    }
    public async activate(): Promise<void> {
        if (this.memento.get<boolean>(amlComputeMementoKey, false)) {
            setSharedProperty('isamlcompute', true);
            return;
        }
        if (this.isAmlComputeWorkspace()) {
            setSharedProperty('isamlcompute', true);
            // Next time user opens VSC on this machine, it is known to be an AML compute (even if there are no workspace folders open).
            this.memento.update(amlComputeMementoKey, true).then(noop, noop);
        } else {
            setSharedProperty('isamlcompute', false);
        }
    }
}
