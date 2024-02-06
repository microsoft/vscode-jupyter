// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExportedKernelService } from '../../../api';

export const IExportedKernelServiceFactory = Symbol('IExportedKernelServiceFactory');
export interface IExportedKernelServiceFactory {
    getService(): Promise<IExportedKernelService | undefined>;
}
