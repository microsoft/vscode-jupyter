// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseError } from '../../common/errors';
import '../../common/extensions';

export class JupyterSelfCertsError extends BaseError {
    constructor(message: string) {
        super('jupyterselfcert', message);
    }
}
