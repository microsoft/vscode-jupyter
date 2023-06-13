// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IKernel } from '../../../../kernels/types';
import { INbExtensionsPathProvider } from '../types';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';
import { IPythonExtensionChecker } from '../../../../platform/api/types';
import { noop } from '../../../../platform/common/utils/misc';

/**
 * Returns the path to the nbExtensions folder for a given kernel (node)
 */
@injectable()
export class NbExtensionsPathProvider implements INbExtensionsPathProvider {
    constructor(
        @inject(IInterpreterService) private readonly interpreter: IInterpreterService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}
    async getNbExtensionsParentPath(kernel: IKernel): Promise<Uri | undefined> {
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'connectToLiveRemoteKernel':
            case 'startUsingRemoteKernelSpec': {
                return Uri.parse(kernel.kernelConnectionMetadata.baseUrl);
            }
            case 'startUsingPythonInterpreter': {
                let sysPrefix = kernel.kernelConnectionMetadata.interpreter.sysPrefix;
                if (
                    !kernel.kernelConnectionMetadata.interpreter.sysPrefix &&
                    this.extensionChecker.isPythonExtensionActive
                ) {
                    const interpreter = await this.interpreter
                        .getInterpreterDetails(kernel.kernelConnectionMetadata.interpreter.id)
                        .catch(noop);
                    if (interpreter) {
                        sysPrefix = sysPrefix || interpreter.sysPrefix;
                    }
                }
                return sysPrefix ? Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter') : undefined;
            }
            default: {
                // We haven't come across scenarios with non-python kernels that use widgets
                // & have custom widget sources. If we do, we can implement that as we come across them.
                return;
            }
        }
    }
}
