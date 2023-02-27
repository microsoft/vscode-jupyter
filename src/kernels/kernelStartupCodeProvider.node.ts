// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CodeSnippets } from '../platform/common/constants';
import { format } from '../platform/common/helpers';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { KernelWorkingFolder } from './kernelWorkingFolder.node';
import { IKernel, IStartupCodeProvider, StartupCodePriority } from './types';

@injectable()
export class KernelStartupCodeProvider implements IStartupCodeProvider {
    public priority = StartupCodePriority.Base;

    constructor(@inject(KernelWorkingFolder) private readonly kernelWorkingFolder: KernelWorkingFolder) {}

    async getCode(kernel: IKernel): Promise<string[]> {
        const suggestedDir = await this.kernelWorkingFolder.getWorkingDirectory(kernel);
        if (suggestedDir) {
            return format(CodeSnippets.UpdateCWDAndPath, getFilePath(suggestedDir)).splitLines({ trim: false });
        }
        return [];
    }
}
