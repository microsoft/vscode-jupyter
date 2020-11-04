// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Kernel, KernelManager, Session, SessionManager } from '@jupyterlab/services';
import { IJupyterServerConnectionInfo } from '../ui/types';

export async function getActiveSessions(connectionInfo: IJupyterServerConnectionInfo): Promise<Session.IModel[]> {
    const mgr = new SessionManager({ serverSettings: connectionInfo.settings });
    await mgr.refreshRunning();
    const sessions: Session.IModel[] = [];
    const iterator = mgr.running();
    let session = iterator.next();

    while (session) {
        sessions.push(session);
        session = iterator.next();
    }

    return sessions;
}
export async function getActiveKernels(connectionInfo: IJupyterServerConnectionInfo): Promise<Kernel.IModel[]> {
    const kernelManager = new KernelManager({ serverSettings: connectionInfo.settings });
    await kernelManager.refreshRunning();
    const kernels: Kernel.IModel[] = [];
    const iterator = kernelManager.running();
    let kernel = iterator.next();

    while (kernel) {
        kernels.push(kernel);
        kernel = iterator.next();
    }

    return kernels;
}
export async function getKernelSpecs(
    connectionInfo: IJupyterServerConnectionInfo
): Promise<{ default?: string; specs: Kernel.ISpecModel[] }> {
    const kernelManager = new KernelManager({ serverSettings: connectionInfo.settings });
    await kernelManager.refreshSpecs();
    const specs = kernelManager.specs;
    if (!specs) {
        return { specs: [] };
    }
    const kernelSpecs = Object.keys(specs.kernelspecs).map((item) => specs.kernelspecs[item]);
    return {
        default: specs.default,
        specs: kernelSpecs
    };
}
