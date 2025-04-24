// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernel } from '../../kernels/types';
import { execCodeInBackgroundThread } from '../api/kernels/backgroundExecution';

export async function sendPipListRequest(kernel: IKernel, token: vscode.CancellationToken) {
    const codeToExecute = `import subprocess
proc = subprocess.Popen(["pip", "list", "--format", "json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
stdout, stderr = proc.communicate()
return stdout
`.split('\n');

    try {
        const content = await execCodeInBackgroundThread<packageDefinition[]>(kernel, codeToExecute, token);
        return { content };
    } catch (ex) {
        throw ex;
    }
}

type packageDefinition = { name: string; version: string };
