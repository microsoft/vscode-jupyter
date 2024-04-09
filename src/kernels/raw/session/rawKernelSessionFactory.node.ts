// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as path from '../../../platform/vscode-path/path';
import { untildify } from '../../../platform/common/platform/fileUtils.node';
import { injectable, inject } from 'inversify';
import { traceVerbose, traceError } from '../../../platform/logging';
import { getDisplayPath, getFilePath } from '../../../platform/common/platform/fs-paths';
import { IConfigurationService, type Resource } from '../../../platform/common/types';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import {
    IRawKernelSession,
    LocaLKernelSessionCreationOptions,
    LocalKernelConnectionMetadata,
    isLocalConnection
} from '../../types';
import { IKernelLauncher, IRawKernelSessionFactory } from '../types';
import { isCancellationError, raceCancellationError } from '../../../platform/common/cancellation';
import { noop } from '../../../platform/common/utils/misc';
import { RawJupyterSessionWrapper } from './rawJupyterSession.node';
import { RawSessionConnection } from './rawSessionConnection.node';
import { computeWorkingDirectory } from '../../../platform/common/application/workspace.node';
import { expandWorkingDir } from '../../jupyter/jupyterUtils';
import { IFileSystem } from '../../../platform/common/platform/types';
import { getNotebookTelemetryTracker } from '../../telemetry/notebookTelemetry';

@injectable()
export class RawKernelSessionFactory implements IRawKernelSessionFactory {
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}

    public async create(options: LocaLKernelSessionCreationOptions): Promise<IRawKernelSession> {
        traceVerbose(`Creating raw notebook for resource '${getDisplayPath(options.resource)}'`);
        let session: RawSessionConnection | undefined;
        const cwdTracker = getNotebookTelemetryTracker(options.resource)?.computeCwd();
        const [workingDirectory, localWorkingDirectory] = await Promise.all([
            raceCancellationError(
                options.token,
                computeWorkingDirectory(options.resource).then((dir) => vscode.Uri.file(dir))
            ),
            isLocalConnection(options.kernelConnection)
                ? raceCancellationError(
                      options.token,
                      computeLocalWorkingDirectory(options.resource, this.configService, this.fs).then((dir) =>
                          dir ? vscode.Uri.file(dir) : undefined
                      )
                  )
                : undefined,
            raceCancellationError(
                options.token,
                trackKernelResourceInformation(options.resource, { kernelConnection: options.kernelConnection })
            )
        ]);
        cwdTracker?.stop();
        const launchTimeout = this.configService.getSettings(options.resource).jupyterLaunchTimeout;
        session = new RawSessionConnection(
            options.resource,
            this.kernelLauncher,
            localWorkingDirectory || workingDirectory,
            options.kernelConnection as LocalKernelConnectionMetadata,
            launchTimeout,
            (options.resource?.path || '').toLowerCase().endsWith('.ipynb') ? 'notebook' : 'console'
        );
        try {
            await raceCancellationError(options.token, session.startKernel(options));
        } catch (error) {
            if (isCancellationError(error) || options.token.isCancellationRequested) {
                traceVerbose('Starting of raw session cancelled by user');
            } else {
                traceError(`Failed to connect raw kernel session: ${error}`);
            }
            // Make sure we shut down our session in case we started a process
            session
                ?.shutdown()
                .catch((error) => traceError(`Failed to dispose of raw session on launch error: ${error} `))
                .finally(() => session?.dispose())
                .catch(noop);
            throw error;
        }

        return new RawJupyterSessionWrapper(session, options.resource, options.kernelConnection);
    }
}

export async function computeLocalWorkingDirectory(
    resource: Resource,
    configService: IConfigurationService,
    fs: IFileSystem
): Promise<string | undefined> {
    let suggestedDir = await doComputeLocalWorkingDirectory(resource, configService, fs);
    if (suggestedDir && (await fs.exists(suggestedDir))) {
        return suggestedDir.fsPath;
    } else if (resource && resource.scheme !== 'untitled' && (await fs.exists(resource))) {
        // Combine the working directory with this file if possible.
        suggestedDir = vscode.Uri.file(
            expandWorkingDir(getFilePath(suggestedDir), resource, configService.getSettings(resource))
        );
        if (suggestedDir && (await fs.exists(suggestedDir))) {
            return suggestedDir.fsPath;
        }
    }
}

async function doComputeLocalWorkingDirectory(
    resource: Resource,
    configService: IConfigurationService,
    fs: IFileSystem
): Promise<vscode.Uri | undefined> {
    let workingDir: vscode.Uri | undefined;
    // For a local launch calculate the working directory that we should switch into
    const settings = configService.getSettings(resource);
    const fileRootStr = untildify(settings.notebookFileRoot);

    // If we don't have a workspace open the notebookFileRoot seems to often have a random location in it (we use ${workspaceRoot} as default)
    // so only do this setting if we actually have a valid workspace open
    if (fileRootStr && vscode.workspace.workspaceFolders?.length) {
        const fileRoot = vscode.Uri.file(fileRootStr);
        const workspaceFolderPath = vscode.workspace.workspaceFolders![0].uri;
        if (path.isAbsolute(fileRootStr)) {
            if (await fs.exists(fileRoot)) {
                // User setting is absolute and exists, use it
                workingDir = fileRoot;
            } else {
                // User setting is absolute and doesn't exist, use workspace
                workingDir = workspaceFolderPath;
            }
        } else if (!fileRootStr.includes('${')) {
            // fileRoot is a relative path, combine it with the workspace folder
            const combinedPath = vscode.Uri.joinPath(workspaceFolderPath, fileRootStr);
            if (await fs.exists(combinedPath)) {
                // combined path exists, use it
                workingDir = combinedPath;
            } else {
                // Combined path doesn't exist, use workspace
                workingDir = workspaceFolderPath;
            }
        } else {
            // fileRoot is a variable that hasn't been expanded
            workingDir = fileRoot;
        }
    }
    return workingDir;
}
