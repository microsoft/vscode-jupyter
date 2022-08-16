// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProcessService } from '../../platform/common/process/proc.node';
export * from './helpers';

export async function uninstallIPyKernel(pythonExecPath: string) {
    // Uninstall ipykernel from the virtual env.
    const proc = new ProcessService();
    await proc.exec(pythonExecPath, ['-m', 'pip', 'uninstall', 'ipykernel', '--yes']);
}
export async function installIPyKernel(pythonExecPath: string) {
    // Uninstall ipykernel from the virtual env.
    const proc = new ProcessService();
    await proc.exec(pythonExecPath, ['-m', 'pip', 'install', 'ipykernel']);
}
