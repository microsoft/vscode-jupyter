// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseError } from '../../common/errors';
import '../../common/extensions';
import * as localize from '../../common/utils/localize';

export class JupyterDebuggerPortBlockedError extends BaseError {
    constructor(portNumber: number, rangeBegin: number, rangeEnd: number) {
        super(
            'debugger',
            portNumber === -1
                ? localize.DataScience.jupyterDebuggerPortBlockedSearchError().format(
                      rangeBegin.toString(),
                      rangeEnd.toString()
                  )
                : localize.DataScience.jupyterDebuggerPortBlockedError().format(portNumber.toString())
        );
    }
}
