// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { IPlatformService } from '../../../platform/common/platform/types';
import { ITrustedKernelPaths } from './types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { createDeferred } from '../../../platform/common/utils/async';

@injectable()
export class TrustedKernelPaths implements ITrustedKernelPaths {
    public static IsKernelSpecHidden = createDeferred<boolean>();
    private readonly programData = process.env['PROGRAMDATA']
        ? Uri.file(path.normalize(process.env['PROGRAMDATA']))
        : undefined;
    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}
    private get trustedKernelSpecs(): string[] {
        return this.workspace.getConfiguration('jupyter', undefined).get<string[]>('kernels.trusted', []);
    }
    public isTrusted(kernelPath: Uri): boolean {
        const trusted = this.isTrustedImpl(kernelPath);
        if (!trusted && !TrustedKernelPaths.IsKernelSpecHidden.completed) {
            TrustedKernelPaths.IsKernelSpecHidden.resolve(true);
        }
        return trusted;
    }
    private isTrustedImpl(kernelPath: Uri): boolean {
        if (kernelPath.scheme !== 'file') {
            return true;
        }
        if (
            this.trustedKernelSpecs
                .map((p) => (this.platform.isWindows ? p.toLowerCase() : p))
                .map((p) => Uri.file(p).path)
                .includes(this.platform.isWindows ? kernelPath.path.toLowerCase() : kernelPath.path)
        ) {
            return true;
        }
        if (this.platform.isWindows && this.programData) {
            return !kernelPath.path.toLowerCase().startsWith(this.programData.path.toLowerCase());
        }
        return true;
    }
}
