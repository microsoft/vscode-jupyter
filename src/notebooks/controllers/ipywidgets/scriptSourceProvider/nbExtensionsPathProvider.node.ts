// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Uri } from 'vscode';
import { IKernel } from '../../../../kernels/types';
import { INbExtensionsPathProvider } from '../types';
import { getSysPrefix } from '../../../../platform/interpreter/helpers';

/**
 * Returns the path to the nbExtensions folder for a given kernel (node)
 */
@injectable()
export class NbExtensionsPathProvider implements INbExtensionsPathProvider {
    async getNbExtensionsParentPath(kernel: IKernel): Promise<Uri | undefined> {
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec': {
                return Uri.parse(kernel.kernelConnectionMetadata.baseUrl);
            }
            case 'startUsingPythonInterpreter': {
                const sysPrefix = await getSysPrefix(kernel.kernelConnectionMetadata.interpreter);
                if (!sysPrefix) {
                    return;
                }
                return Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter');
            }
            default: {
                // We haven't come across scenarios with non-python kernels that use widgets
                // & have custom widget sources. If we do, we can implement that as we come across them.
                return;
            }
        }
    }
}
