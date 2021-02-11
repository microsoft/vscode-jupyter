// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseError } from '../../common/errors/types';
import '../../common/extensions';
import * as localize from '../../common/utils/localize';

export class JupyterDebuggerRemoteNotSupported extends BaseError {
    constructor() {
        super('debugger', localize.DataScience.remoteDebuggerNotSupported());
    }
}
