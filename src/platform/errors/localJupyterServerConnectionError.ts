// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

/**
 * Generic error when the local jupyter server fails to start. Local means we started it.
 *
 * Cause:
 * Some problem when trying to connect to a local jupyter server. Usually indicates an installation problem.
 *
 * Handled by:
 * First cell to be run should show the connection error.
 */
export class LocalJupyterServerConnectionError extends BaseError {
    constructor(public readonly originalError: Error) {
        super(
            'localjupyterserverconnection',
            DataScience.jupyterNotebookFailure().format(originalError.message || originalError.toString())
        );
    }
}
