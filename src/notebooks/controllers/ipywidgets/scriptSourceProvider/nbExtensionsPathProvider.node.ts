// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Uri } from 'vscode';
import { IKernel } from '../../../../kernels/types';
import { INbExtensionsPathProvider } from '../types';

/**
 * Returns the path to the nbExtensions folder for a given kernel (node)
 */
@injectable()
export class NbExtensionsPathProvider implements INbExtensionsPathProvider {
    getNbExtensionsParentPath(kernel: IKernel): Uri | undefined {
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec': {
                return Uri.parse(kernel.kernelConnectionMetadata.baseUrl);
            }
            case 'startUsingPythonInterpreter': {
                return Uri.joinPath(
                    Uri.file(kernel.kernelConnectionMetadata.interpreter.sysPrefix),
                    'share',
                    'jupyter'
                );
            }
            default: {
                // We haven't come across scenarios with non-python kernels that use widgets
                // & have custom widget sources. If we do, we can implement that as we come across them.
                return;
            }
        }
    }
}
