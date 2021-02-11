// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseError } from '../../common/errors';
import '../../common/extensions';

export class JupyterConnectError extends BaseError {
    constructor(message: string, stderr?: string) {
        super('jupyterconnection', message + (stderr ? `\n${stderr}` : ''));
    }
}
