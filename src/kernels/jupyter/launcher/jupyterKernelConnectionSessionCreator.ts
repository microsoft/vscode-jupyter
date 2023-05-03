// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { Cancellation } from '../../../platform/common/cancellation';
import {
    IJupyterKernelConnectionSession,
    KernelConnectionSessionCreationOptions,
    isLocalConnection
} from '../../types';
import { IJupyterSessionManager } from '../types';
import { traceInfo } from '../../../platform/logging';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { inject, injectable } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';

export type JupyterKernelConnectionSessionCreationOptions = KernelConnectionSessionCreationOptions & {
    sessionManager: IJupyterSessionManager;
};

@injectable()
export class JupyterKernelConnectionSessionCreator {
    constructor(@inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService) {}
    public async create(
        options: JupyterKernelConnectionSessionCreationOptions
    ): Promise<IJupyterKernelConnectionSession> {
        Cancellation.throwIfCanceled(options.token);
        // Figure out the working directory we need for our new notebook. This is only necessary for local.
        const workingDirectory = isLocalConnection(options.kernelConnection)
            ? await this.workspaceService.computeWorkingDirectory(options.resource)
            : '';
        Cancellation.throwIfCanceled(options.token);
        // Start a session (or use the existing one if allowed)
        const session = await options.sessionManager.startNew(
            options.resource,
            options.kernelConnection,
            Uri.file(workingDirectory),
            options.ui,
            options.token,
            options.creator
        );
        if (options.token.isCancellationRequested) {
            // Even if this is a remote kernel, we should shut this down as it's not needed.
            session.shutdown().catch(noop);
        }
        Cancellation.throwIfCanceled(options.token);
        traceInfo(`Started session for kernel ${options.kernelConnection.kind}:${options.kernelConnection.id}`);
        return session;
    }
}
