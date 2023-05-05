// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { Cancellation } from '../../../platform/common/cancellation';
import {
    IJupyterKernelSession,
    KernelSessionCreationOptions,
    isLocalConnection,
    isRemoteConnection
} from '../../types';
import { IJupyterSessionManager } from '../types';
import { traceError, traceInfo } from '../../../platform/logging';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { inject, injectable } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';

export type JupyterKernelSessionCreationOptions = KernelSessionCreationOptions & {
    sessionManager: IJupyterSessionManager;
};

@injectable()
export class JupyterKernelConnectionSessionCreator {
    constructor(@inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService) {}
    public async create(options: JupyterKernelSessionCreationOptions): Promise<IJupyterKernelSession> {
        if (options.sessionManager.isDisposed) {
            throw new SessionDisposedError();
        }
        if (isRemoteConnection(options.kernelConnection)) {
            try {
                await Promise.all([
                    options.sessionManager.getRunningKernels(),
                    options.sessionManager.getKernelSpecs()
                ]);
            } catch (ex) {
                traceError(
                    'Failed to fetch running kernels from remote server, connection may be outdated or remote server may be unreachable',
                    ex
                );
                throw new RemoteJupyterServerConnectionError(
                    options.kernelConnection.baseUrl,
                    options.kernelConnection.serverId,
                    ex
                );
            }
        }

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
