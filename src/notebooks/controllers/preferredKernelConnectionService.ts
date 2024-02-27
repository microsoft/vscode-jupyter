// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, NotebookDocument, workspace, Uri } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../kernels/internalTypes';
import { PreferredRemoteKernelIdProvider } from '../../kernels/jupyter/connection/preferredRemoteKernelIdProvider';
import {
    IKernelFinder,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata,
    isRemoteConnection
} from '../../kernels/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IDisposable } from '../../platform/common/types';
import { getNotebookMetadata, translateKernelLanguageToMonaco } from '../../platform/common/utils';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { ServiceContainer } from '../../platform/ioc/container';
import { getLanguageOfNotebookDocument } from '../languages/helpers';
import * as path from '../../platform/vscode-path/resources';
import { isParentPath } from '../../platform/common/platform/fileUtils';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import { getRemoteSessionOptions } from '../../kernels/jupyter/session/jupyterSession';
import { getEnvironmentType } from '../../platform/interpreter/helpers';

/**
 * Attempt to clean up https://github.com/microsoft/vscode-jupyter/issues/11914
 * Provides the ability to look for exact or preferred kernel connections.
 * Note: This class has zero side effects unlike `ControllerPreferredService`, and is meant to be a replacement for it
 */
export class PreferredKernelConnectionService {
    private readonly disposables: IDisposable[] = [];
    constructor(private readonly jupyterConnection: JupyterConnection) {}
    public dispose() {
        dispose(this.disposables);
    }
    public async findPreferredRemoteKernelConnection(
        notebook: NotebookDocument,
        kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>,
        cancelToken: CancellationToken
    ): Promise<RemoteKernelConnectionMetadata | undefined> {
        return this.findPreferredRemoteKernelConnectionImpl(notebook, kernelFinder, cancelToken, false);
    }
    private async findPreferredRemoteKernelConnectionImpl(
        notebook: NotebookDocument,
        kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>,
        cancelToken: CancellationToken,
        findExactMatch: boolean
    ): Promise<RemoteKernelConnectionMetadata | undefined> {
        const preferredRemoteKernelId = await ServiceContainer.instance
            .get<PreferredRemoteKernelIdProvider>(PreferredRemoteKernelIdProvider)
            .getPreferredRemoteKernelId(notebook.uri);

        const findLiveKernelConnection = async () => {
            let liveKernelMatchingIdFromCurrentKernels = kernelFinder.kernels.find(
                (item) => item.kind === 'connectToLiveRemoteKernel' && item.id === preferredRemoteKernelId
            ) as LiveRemoteKernelConnectionMetadata;
            if (liveKernelMatchingIdFromCurrentKernels) {
                return liveKernelMatchingIdFromCurrentKernels;
            }

            // Possible we haven't discovered it yet, hence wait for a match.
            // we still haven't found the kernel, lets wait for a bit.
            if (kernelFinder.status === 'idle') {
                return;
            }
            const liveKernelMatchingId = await new Promise<LiveRemoteKernelConnectionMetadata | undefined>((resolve) =>
                kernelFinder.onDidChangeKernels(
                    () => {
                        const kernel = kernelFinder.kernels.find(
                            (item) => item.kind === 'connectToLiveRemoteKernel' && item.id === preferredRemoteKernelId
                        ) as LiveRemoteKernelConnectionMetadata;
                        if (kernel) {
                            resolve(kernel);
                        }
                        if (kernelFinder.status === 'idle' || cancelToken.isCancellationRequested) {
                            resolve(undefined);
                        }
                    },
                    this,
                    this.disposables
                )
            );
            if (liveKernelMatchingId) {
                return liveKernelMatchingId;
            }

            if (findExactMatch) {
                // If we have a live kernel id and the kernel no longer exists, then we cannot find an exact match,
                // However this could mean the live kernel no longer exists, hence we should match the kernel spec,
                // that is still an exact match.
                return;
            }
        };
        if (preferredRemoteKernelId) {
            const kernel = await findLiveKernelConnection();
            if (kernel || findExactMatch) {
                return kernel;
            }
        }
        // If this is a remote kernel from a remote provider, we might have existing sessions.
        // Existing sessions for the same path would be a suggestions.
        const serverId = (
            kernelFinder.kernels.find((item) => isRemoteConnection(item)) as RemoteKernelConnectionMetadata | undefined
        )?.serverProviderHandle;
        if (serverId) {
            const connection = await this.jupyterConnection.createConnectionInfo(serverId);
            const sessionOptions = getRemoteSessionOptions(connection, notebook.uri);
            const matchingSession =
                sessionOptions &&
                kernelFinder.kernels.find(
                    (item) =>
                        isRemoteConnection(item) &&
                        item.kind === 'connectToLiveRemoteKernel' &&
                        item.kernelModel.model &&
                        item.kernelModel.model.path === sessionOptions.path &&
                        item.kernelModel.model.name === sessionOptions.name
                );
            if (matchingSession) {
                return matchingSession as RemoteKernelConnectionMetadata;
            }
        }

        return this.findPreferredKernelSpecConnection(notebook, kernelFinder, cancelToken, findExactMatch!) as Promise<
            RemoteKernelConnectionMetadata | undefined
        >;
    }
    public async findPreferredLocalKernelSpecConnection(
        notebook: NotebookDocument,
        kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>,
        cancelToken: CancellationToken
    ): Promise<LocalKernelSpecConnectionMetadata | undefined> {
        return this.findPreferredKernelSpecConnection(notebook, kernelFinder, cancelToken, false) as Promise<
            LocalKernelSpecConnectionMetadata | undefined
        >;
    }
    private async findPreferredKernelSpecConnection(
        notebook: NotebookDocument,
        kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>,
        cancelToken: CancellationToken,
        findExactMatch: boolean
    ): Promise<LocalKernelSpecConnectionMetadata | RemoteKernelSpecConnectionMetadata | undefined> {
        const metadata = getNotebookMetadata(notebook);
        const kernelSpecName = metadata?.kernelspec?.name;
        const findMatchBasedOnKernelNameOrLanguage = () => {
            const kernelsMatchingKernelName = kernelSpecName
                ? (kernelFinder.kernels.filter(
                      (item) =>
                          (item.kind === 'startUsingLocalKernelSpec' || item.kind === 'startUsingRemoteKernelSpec') &&
                          item.kernelSpec.name === kernelSpecName
                  ) as (LocalKernelSpecConnectionMetadata | RemoteKernelSpecConnectionMetadata)[])
                : [];
            if (kernelsMatchingKernelName.length || findExactMatch) {
                return kernelsMatchingKernelName;
            }

            const language = getLanguageOfNotebookDocument(notebook);
            if (!language) {
                return;
            }
            return kernelFinder.kernels.filter(
                (item) =>
                    (item.kind === 'startUsingLocalKernelSpec' || item.kind === 'startUsingRemoteKernelSpec') &&
                    item.kernelSpec.language &&
                    (item.kernelSpec.language === language ||
                        translateKernelLanguageToMonaco(item.kernelSpec.language) ===
                            translateKernelLanguageToMonaco(language))
            ) as (LocalKernelSpecConnectionMetadata | RemoteKernelSpecConnectionMetadata)[];
        };

        const found = findMatchBasedOnKernelNameOrLanguage();
        if (Array.isArray(found) && found.length) {
            if (findExactMatch && found.length > 1) {
                // Too many matches.
                return;
            }
            return found[0];
        }
        // Possible we haven't discovered everything yet, hence wait for a match.
        // we still haven't found the kernel, lets wait for a bit.
        if (kernelFinder.status === 'idle') {
            return;
        }

        const disposables: IDisposable[] = [];
        return new Promise<LocalKernelSpecConnectionMetadata | RemoteKernelSpecConnectionMetadata | undefined>(
            (resolve) =>
                kernelFinder.onDidChangeKernels(
                    () => {
                        // Would happen when the picker is closed...
                        if (cancelToken.isCancellationRequested) {
                            return resolve(undefined);
                        }
                        const found = findMatchBasedOnKernelNameOrLanguage();
                        if (Array.isArray(found) && found.length) {
                            if (findExactMatch && found.length > 1) {
                                // Too many matches.
                                return resolve(undefined);
                            }
                            return resolve(found[0]);
                        }

                        if (kernelFinder.status === 'idle') {
                            resolve(undefined);
                        }
                    },
                    this,
                    this.disposables
                )
        ).finally(() => dispose(disposables));
    }
    public async findPreferredPythonKernelConnection(
        notebook: NotebookDocument,
        kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>,
        cancelToken: CancellationToken
    ): Promise<PythonKernelConnectionMetadata | undefined> {
        return this.findPreferredPythonKernelConnectionImpl(notebook, kernelFinder, cancelToken);
    }
    private async findPreferredPythonKernelConnectionImpl(
        notebook: NotebookDocument,
        kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>,
        cancelToken: CancellationToken
    ): Promise<PythonKernelConnectionMetadata | undefined> {
        kernelFinder =
            kernelFinder ||
            ServiceContainer.instance
                .get<IKernelFinder>(IKernelFinder)
                .registered.find((item) => item.kind === ContributedKernelFinderKind.LocalPythonEnvironment)!;

        const interpreterService = ServiceContainer.instance.get<IInterpreterService>(IInterpreterService);

        // 1. Check if we have a .conda or .venv virtual env in the local workspace folder.
        const localEnv = findPythonEnvClosesToNotebook(notebook, kernelFinder);
        if (localEnv) {
            return localEnv;
        }

        // 2. Fall back to the active interpreter.
        const activeInterpreter = await interpreterService.getActiveInterpreter(notebook.uri);
        if (!activeInterpreter) {
            return;
        }
        const findMatchingActiveInterpreterKernel = () => {
            if (cancelToken.isCancellationRequested) {
                return;
            }
            return kernelFinder.kernels
                .filter((item) => item.kind === 'startUsingPythonInterpreter')
                .map((k) => k as PythonKernelConnectionMetadata)
                .find((k) => k.interpreter.id === activeInterpreter.id);
        };
        // 3. Fall back to the active interpreter.
        const activeInterpreterKernel = findMatchingActiveInterpreterKernel();
        if (activeInterpreterKernel) {
            return activeInterpreterKernel;
        }

        // 4. Possible we're still discovering python environments.
        // Wait for all interpreters to be discovered so we can find the matching interpreter as defined in the metadata.
        if (kernelFinder.status === 'discovering') {
            await new Promise<void>((resolve) => {
                kernelFinder.onDidChangeStatus(
                    () => kernelFinder.status === 'idle' && resolve(),
                    this,
                    this.disposables
                );
                kernelFinder.onDidChangeKernels(
                    () =>
                        (findPythonEnvClosesToNotebook(notebook, kernelFinder) ||
                            findMatchingActiveInterpreterKernel()) &&
                        resolve(),
                    this,
                    this.disposables
                );
            });
            // Try again
            return findPythonEnvClosesToNotebook(notebook, kernelFinder) || findMatchingActiveInterpreterKernel();
        }
    }
}

function findPythonEnvClosesToNotebook(
    notebook: NotebookDocument,
    kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>
) {
    const defaultFolder =
        workspace.getWorkspaceFolder(notebook.uri)?.uri ||
        (workspace.workspaceFolders?.length === 1 ? workspace.workspaceFolders[0].uri : undefined);
    const localEnvNextToNbFile = findLocalPythonEnv(path.dirname(notebook.uri), kernelFinder);
    if (localEnvNextToNbFile) {
        return localEnvNextToNbFile;
    }
    if (defaultFolder) {
        return findLocalPythonEnv(defaultFolder, kernelFinder);
    }
}
function findLocalPythonEnv(folder: Uri, kernelFinder: IContributedKernelFinder<KernelConnectionMetadata>) {
    const pythonEnvs = kernelFinder.kernels
        .filter((k) => k.kind === 'startUsingPythonInterpreter')
        .map((k) => k as PythonKernelConnectionMetadata);

    const localEnvs = pythonEnvs.filter((p) =>
        // eslint-disable-next-line local-rules/dont-use-fspath
        isParentPath(p.interpreter.envPath?.fsPath || p.interpreter.uri.fsPath, folder.fsPath)
    );

    const venv = localEnvs.find(
        (e) =>
            getEnvironmentType(e.interpreter) === EnvironmentType.Venv &&
            e.interpreter.envName?.toLowerCase() === '.venv'
    );
    if (venv) {
        return venv;
    }
    const conda = localEnvs.find(
        (e) =>
            getEnvironmentType(e.interpreter) === EnvironmentType.Conda &&
            e.interpreter.envName?.toLowerCase() === '.venv'
    );
    if (conda) {
        return conda;
    }
    const anyVenv = localEnvs.find((e) => e.interpreter.envName?.toLowerCase() === '.venv');
    if (anyVenv) {
        return anyVenv;
    }
    return localEnvs.length ? localEnvs[0] : undefined;
}
