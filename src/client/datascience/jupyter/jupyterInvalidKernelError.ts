// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import * as localize from '../../common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { getDisplayNameOrNameOfKernelConnection } from './kernels/helpers';
import { KernelConnectionMetadata } from './kernels/types';

export class JupyterInvalidKernelError extends BaseError {
    constructor(public readonly kernelConnectionMetadata: KernelConnectionMetadata | undefined) {
        super(
            'invalidkernel',
            localize.DataScience.kernelInvalid().format(
                getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)
            )
        );
        sendTelemetryEvent(Telemetry.KernelInvalid);
    }
}
