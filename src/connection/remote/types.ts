// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Contents, Kernel, KernelSpec, ServerConnection, Session, Terminal } from '@jupyterlab/services';

export interface IJupyterLabManagers {
    serverSettings: ServerConnection.ISettings;
    sessionManager: Session.IManager;
    kernelManager: Kernel.IManager;
    kernelSpecManager: KernelSpec.IManager;
    contentsManager: Contents.IManager;
    terminalManager: Terminal.IManager;
}
