// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { Uri } from 'vscode';
import { ITrustedKernelPaths } from './types';

@injectable()
export class TrustedKernelPaths implements ITrustedKernelPaths {
    public isTrusted(_kernelPath: Uri): boolean {
        return true;
    }
}
