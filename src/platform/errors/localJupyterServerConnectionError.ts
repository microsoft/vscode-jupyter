// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

export class LocalJupyterServerConnectionError extends BaseError {
    constructor(public readonly originalError: Error) {
        super(
            'localjupyterserverconnection',
            DataScience.jupyterNotebookFailure().format(originalError.message || originalError.toString())
        );
    }
}
