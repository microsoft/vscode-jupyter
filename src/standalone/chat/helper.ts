// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernel } from '../../kernels/types';
import { execCodeInBackgroundThread } from '../api/kernels/backgroundExecution';
import { getEnvExtApi } from '../../platform/api/python-envs/pythonEnvsApi';

export async function sendPipListRequest(kernel: IKernel, token: vscode.CancellationToken) {
    const codeToExecute = `import subprocess
proc = subprocess.Popen(["pip", "list", "--format", "json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
stdout, stderr = proc.communicate()
return stdout
`.split('\n');

    try {
        const packages = await execCodeInBackgroundThread<packageDefinition[]>(kernel, codeToExecute, token);
        return packages;
    } catch (ex) {
        throw ex;
    }
}

export async function sendPipInstallRequest(kernel: IKernel, packages: string[], token: vscode.CancellationToken) {
    const packageList = packages.join('", "');
    const codeToExecute = `import subprocess
proc = subprocess.Popen(["pip", "install", "${packageList}"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
stdout, stderr = proc.communicate()
return {"result": stdout}
`.split('\n');

    try {
        const result = await execCodeInBackgroundThread<{ result: string }>(kernel, codeToExecute, token);
        return result?.result;
    } catch (ex) {
        throw ex;
    }
}

export async function getPackagesFromEnvsExtension(kernelUri: vscode.Uri): Promise<packageDefinition[] | undefined> {
    const envsApi = await getEnvExtApi();
    if (!envsApi) {
        return;
    }

    const environment = await envsApi.resolveEnvironment(kernelUri);
    if (!environment) {
        return;
    }

    return await envsApi.getPackages(environment);
}

export async function installPackageThroughEnvsExtension(kernelUri: vscode.Uri, packages: string[]): Promise<boolean> {
    const envsApi = await getEnvExtApi();
    if (!envsApi) {
        return false;
    }

    const environment = await envsApi.resolveEnvironment(kernelUri);
    if (!environment) {
        return false;
    }

    await envsApi.managePackages(environment, { install: packages });
    return true;
}

export type packageDefinition = { name: string; version?: string };
