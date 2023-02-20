// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseError } from '../../platform/errors/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { Product } from '../installer/types';

/**
 * Thrown when we fail to install a Package due to long path not being enabled on Windows. */
export class PackageNotInstalledWindowsLongPathNotEnabledError extends BaseError {
    constructor(
        public readonly product: Product | string,
        public readonly interpreter: PythonEnvironment,
        public readonly originalMessage: string
    ) {
        super('windowsLongPathNotEnabled', originalMessage);
    }
}
