// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { Debugger } from '../../../notebooks/debugger/debugger';
import { createDeferred } from '../../../platform/common/utils/async';

export class IWDebugger extends Debugger {
    private readonly _ready = createDeferred<void>();
    public readonly ready = this._ready.promise;

    public resolve() {
        this._ready.resolve();
    }
}
