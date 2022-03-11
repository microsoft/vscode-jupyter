// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from './types';

export class JupyterConnectError extends BaseError {
    constructor(message: string, stderr?: string) {
        super('jupyterconnection', message + (stderr ? `\n${stderr}` : ''));
    }
}
