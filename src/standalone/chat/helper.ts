// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { execCodeInBackgroundThread } from '../api/kernels/backgroundExecution';
import { getEnvExtApi } from '../../platform/api/python-envs/pythonEnvsApi';
import { raceTimeout } from '../../platform/common/utils/async';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { raceCancellation } from '../../platform/common/cancellation';

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

export async function ensureKernelSelectedAndStarted(
    notebook: vscode.NotebookDocument,
    controllerRegistration: IControllerRegistration,
    kernelProvider: IKernelProvider,
    token: vscode.CancellationToken
) {
    if (!kernelProvider.get(notebook)) {
        const selectedPromise = new Promise<void>((resolve) =>
            controllerRegistration.onControllerSelected((e) => (e.notebook === notebook ? resolve() : undefined))
        );

        await vscode.commands.executeCommand('notebook.selectKernel', {
            notebookUri: notebook.uri,
            skipIfAlreadySelected: true
        });

        await raceTimeout(200, raceCancellation(token, selectedPromise));
    }

    const controller = controllerRegistration.getSelected(notebook);
    if (controller) {
        return controller.startKernel(notebook);
    }
}
