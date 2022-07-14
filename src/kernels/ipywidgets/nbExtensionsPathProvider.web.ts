// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Uri } from 'vscode';
import { INotebookKernel } from '../types';
import { INbExtensionsPathProvider } from './types';

@injectable()
export class NbExtensionsPathProvider implements INbExtensionsPathProvider {
    getNbExtensionsParentPath(kernel: INotebookKernel): Uri | undefined {
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
