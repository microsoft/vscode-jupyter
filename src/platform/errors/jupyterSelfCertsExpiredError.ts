// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from './types';

export class JupyterSelfCertsExpiredError extends BaseError {
    constructor(message: string) {
        super('jupyterselfexpiredcert', message);
    }
    public static isSelfCertsExpiredError(err: Error) {
        return err.message.indexOf('reason: certificate has expired') >= 0;
    }
}
