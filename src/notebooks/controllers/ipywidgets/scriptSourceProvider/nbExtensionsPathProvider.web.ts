// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Uri } from 'vscode';
import { IKernel } from '../../../../kernels/types';
import { INbExtensionsPathProvider } from '../types';

/**
 * Returns the path to the nbExtensions folder for a given kernel (web)
 */
@injectable()
export class NbExtensionsPathProvider implements INbExtensionsPathProvider {
    async getNbExtensionsParentPath(kernel: IKernel): Promise<Uri | undefined> {
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec': {
                return Uri.parse(kernel.kernelConnectionMetadata.baseUrl);
            }
            default: {
                // Not possible a possible code path in web.
                return;
            }
        }
    }
}
