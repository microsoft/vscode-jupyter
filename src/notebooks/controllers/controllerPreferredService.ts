// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { INotebookMetadata } from '@jupyterlab/nbformat';
import { injectable, inject } from 'inversify';
import {
    CancellationToken,
    CancellationTokenSource,
    Disposable,
    NotebookControllerAffinity,
    NotebookDocument,
    workspace
} from 'vscode';
import { getKernelConnectionLanguage, getLanguageInNotebookMetadata, isPythonNotebook } from '../../kernels/helpers';
import { ContributedKernelFinderKind } from '../../kernels/internalTypes';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { trackKernelResourceInformation } from '../../kernels/telemetry/helper';
import { IKernelFinder, isLocalConnection, KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import {
    JupyterNotebookView,
    InteractiveWindowView,
    PYTHON_LANGUAGE,
    Telemetry
} from '../../platform/common/constants';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IDisposable, IDisposableRegistry, IsWebExtension, Resource } from '../../platform/common/types';
import { getNotebookMetadata, getResourceType, isJupyterNotebook } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import {
    logValue,
    traceDecoratorVerbose,
    traceError,
    traceInfo,
    traceInfoIfCI,
    traceVerbose
} from '../../platform/logging';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { findKernelSpecMatchingInterpreter } from './kernelRanking/helpers';
import {
    IControllerDefaultService,
    IControllerLoader,
    IControllerPreferredService,
    IControllerRegistration,
    IControllerSelection,
    IKernelRankingHelper,
    IVSCodeNotebookController,
    PreferredKernelExactMatchReason
} from './types';

/**
 * Computes and tracks the preferred kernel for a notebook.
 * Preferred is determined from the metadata in the notebook. If no metadata is found, the default kernel is used.
 */
@injectable()
export class ControllerPreferredService implements IControllerPreferredService, IExtensionSyncActivationService {
    private preferredControllers = new WeakMap<NotebookDocument, IVSCodeNotebookController>();
    private preferredCancelTokens = new WeakMap<NotebookDocument, CancellationTokenSource>();
    private get isLocalLaunch(): boolean {
        return this.serverUriStorage.isLocalLaunch;
    }
    private disposables = new Set<IDisposable>();
    constructor(
        @inject(IControllerRegistration) private readonly registration: IControllerRegistration,
        @inject(IControllerLoader) private readonly loader: IControllerLoader,
        @inject(IControllerDefaultService) private readonly defaultService: IControllerDefaultService,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IKernelRankingHelper) private readonly kernelRankHelper: IKernelRankingHelper,
        @inject(IControllerSelection) private readonly selection: IControllerSelection,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IsWebExtension) private readonly isWebExtension: boolean
    ) {
        disposables.push(this);
    }
    public activate() {
        // Sign up for document either opening or closing
        this.disposables.add(this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this));
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook));
        this.disposables.add(
            this.notebook.onDidCloseNotebookDocument((document) => {
                const token = this.preferredCancelTokens.get(document);
                if (token) {
                    this.preferredCancelTokens.delete(document);
                    token.cancel();
                }
            }, this)
        );
        this.disposables.add(
            this.registration.onChanged(
                ({ added }) =>
                    added.length
                        ? this.notebook.notebookDocuments.map((nb) => this.onDidOpenNotebookDocument(nb))
                        : undefined,
                this
            )
        );

        this.disposables.add(
            this.kernelFinder.onDidChangeStatus(
                () =>
                    this.kernelFinder.status === 'idle'
                        ? this.notebook.notebookDocuments.map((nb) => this.onDidOpenNotebookDocument(nb))
                        : undefined,
                this
            )
        );
    }
    public dispose() {
        disposeAllDisposables(Array.from(this.disposables));
    }
    @traceDecoratorVerbose('Compute Preferred Controller')
    public async computePreferred(
        @logValue<NotebookDocument>('uri') document: NotebookDocument,
        serverId?: string | undefined,
        cancelToken?: CancellationToken
    ): Promise<{
        preferredConnection?: KernelConnectionMetadata | undefined;
        controller?: IVSCodeNotebookController | undefined;
    }> {
        if (!isJupyterNotebook(document)) {
            return {};
        }

        traceInfoIfCI(`Clear controller mapping for ${getDisplayPath(document.uri)}`);
        // Keep track of a token per document so that we can cancel the search if the doc is closed
        this.preferredCancelTokens.get(document)?.cancel();
        this.preferredCancelTokens.get(document)?.dispose();
        const preferredSearchToken = new CancellationTokenSource();
        const changeHandler = cancelToken?.onCancellationRequested(() => preferredSearchToken.cancel());
        this.disposables.add(preferredSearchToken);
        if (changeHandler) {
            this.disposables.add(changeHandler);
        }
        this.preferredCancelTokens.set(document, preferredSearchToken);
        try {
            let preferredConnection: KernelConnectionMetadata | undefined;
            // Don't attempt preferred kernel search for interactive window, but do make sure we
            // load all our controllers for interactive window
            const notebookMetadata = getNotebookMetadata(document);
            const resourceType = getResourceType(document.uri);
            const isPythonNbOrInteractiveWindow = isPythonNotebook(notebookMetadata) || resourceType === 'interactive';
            if (document.notebookType === JupyterNotebookView && !this.isLocalLaunch && isPythonNbOrInteractiveWindow) {
                const defaultPythonController = await this.defaultService.computeDefaultController(
                    document.uri,
                    document.notebookType
                );
                if (preferredSearchToken.token.isCancellationRequested) {
                    return {};
                }
                preferredConnection = defaultPythonController?.connection;
                if (preferredConnection) {
                    traceInfoIfCI(
                        `Found target controller with default controller ${getDisplayPath(document.uri)} ${
                            preferredConnection.kind
                        }:${preferredConnection.id}.`
                    );
                }
            }
            if (preferredSearchToken.token.isCancellationRequested) {
                traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                return {};
            }
            if (document.notebookType === JupyterNotebookView && !preferredConnection) {
                const preferredInterpreter =
                    !serverId && isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                        ? await this.interpreters.getActiveInterpreter(document.uri)
                        : undefined;
                traceInfoIfCI(
                    `Fetching TargetController document  ${getDisplayPath(document.uri)}  with preferred Interpreter ${
                        preferredInterpreter ? getDisplayPath(preferredInterpreter?.uri) : '<undefined>'
                    } for condition ${
                        !serverId && isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                    } (${serverId} && ${isPythonNbOrInteractiveWindow} && ${
                        this.extensionChecker.isPythonExtensionInstalled
                    }).`
                );

                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                    return {};
                }

                // Await looking for the preferred kernel
                preferredConnection = await this.findPreferredKernelExactMatch(
                    document,
                    notebookMetadata,
                    preferredSearchToken.token,
                    preferredInterpreter,
                    serverId
                );
                if (preferredConnection) {
                    traceInfoIfCI(
                        `Found target controller with an exact match (1) ${getDisplayPath(document.uri)} ${
                            preferredConnection.kind
                        }:${preferredConnection.id}.`
                    );
                }
                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                    return {};
                }
                // If we didn't find an exact match in the cache, try awaiting for the non-cache version
                if (!preferredConnection) {
                    // Don't start this ahead of time to save some CPU cycles
                    preferredConnection = await this.findPreferredKernelExactMatch(
                        document,
                        notebookMetadata,
                        preferredSearchToken.token,
                        preferredInterpreter,
                        serverId
                    );
                    if (preferredConnection) {
                        traceInfoIfCI(
                            `Found target controller with an exact match (2) ${getDisplayPath(document.uri)} ${
                                preferredConnection.kind
                            }:${preferredConnection.id}.`
                        );
                    }
                }
                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                    return {};
                }

                // Send telemetry on looking for preferred don't await for sending it
                this.sendPreferredKernelTelemetry(
                    document.uri,
                    notebookMetadata,
                    preferredConnection,
                    preferredInterpreter
                );

                // If we found a preferred kernel, set the association on the NotebookController
                if (preferredSearchToken.token.isCancellationRequested && !preferredConnection) {
                    traceInfo('Find preferred kernel cancelled');
                    return {};
                }
                if (!preferredConnection) {
                    traceInfoIfCI(
                        `PreferredConnection not found for NotebookDocument: ${getDisplayPath(document.uri)}`
                    );
                    if (!preferredConnection && this.preferredControllers.get(document)) {
                        // Possible previously we had just 1 controller and that was setup as the preferred
                        // & now that we have more controllers, we know more about what needs to be matched
                        // & since we no longer have a preferred, we should probably unset the previous preferred
                        traceVerbose(
                            `Resetting the previous preferred controller ${
                                this.preferredControllers.get(document)?.id
                            } to default affinity for document ${getDisplayPath(document.uri)}`
                        );
                        await this.preferredControllers
                            .get(document)
                            ?.controller.updateNotebookAffinity(document, NotebookControllerAffinity.Default);
                    }

                    return {};
                }

                traceInfo(
                    `PreferredConnection: ${preferredConnection.id} found for NotebookDocument: ${getDisplayPath(
                        document.uri
                    )}`
                );

                const targetController = this.registration.registered.find(
                    (value) => preferredConnection?.id === value.connection.id
                );
                // If the controller doesn't exist, then it means we're still loading them.
                // However we can create this one as we have all of the necessary info.
                if (!targetController) {
                    traceVerbose(`Early registration of controller for Kernel connection ${preferredConnection.id}`);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this.registration.addOrUpdate(preferredConnection, [JupyterNotebookView]);
                }
            } else if (document.notebookType === InteractiveWindowView) {
                // Wait for our controllers to be loaded before we try to set a preferred on
                // can happen if a document is opened quick and we have not yet loaded our controllers
                await this.loader.loaded;
                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                    return {};
                }

                // For interactive set the preferred controller as the interpreter or default
                const defaultInteractiveController = await this.defaultService.computeDefaultController(
                    document.uri,
                    'interactive'
                );
                preferredConnection = defaultInteractiveController?.connection;
                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                    return {};
                }
            }

            // See if the preferred connection is in our registered controllers, add the sufix for the interactive scenario
            let targetController: IVSCodeNotebookController | undefined;
            if (preferredConnection) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                targetController = this.registration.get(preferredConnection, document.notebookType as any);
            }

            if (targetController) {
                traceVerbose(
                    `TargetController found ID: ${targetController.connection.kind}:${
                        targetController.id
                    } for document ${getDisplayPath(document.uri)}`
                );
                await this.preferredControllers
                    .get(document)
                    ?.controller.updateNotebookAffinity(document, NotebookControllerAffinity.Default);

                await targetController.controller.updateNotebookAffinity(
                    document,
                    NotebookControllerAffinity.Preferred
                );
                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                    return {};
                }

                await trackKernelResourceInformation(document.uri, {
                    kernelConnection: preferredConnection,
                    isPreferredKernel: true
                });

                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfoIfCI(`Fetching TargetController document ${getDisplayPath(document.uri)} cancelled.`);
                    return {};
                }

                // Save in our map so we can find it in test code.
                this.preferredControllers.set(document, targetController);
            } else if (!preferredConnection && this.preferredControllers.get(document)) {
                // Possible previously we had just 1 controller and that was setup as the preferred
                // & now that we have more controllers, we know more about what needs to be matched
                // & since we no longer have a preferred, we should probably unset the previous preferred
                traceVerbose(
                    `Resetting the previous preferred controller ${
                        this.preferredControllers.get(document)?.id
                    } to default affinity for document ${getDisplayPath(document.uri)}`
                );
                await this.preferredControllers
                    .get(document)
                    ?.controller.updateNotebookAffinity(document, NotebookControllerAffinity.Default);
            }

            if (preferredConnection && !targetController && isLocalConnection(preferredConnection)) {
                // Sometimes on CI we find that we have a preferred connection and the controller doesn't exist.
                // Create the controller if it doesn't exist.
                // This is debt, and should not happen.
                const controller = this.registration.addOrUpdate(preferredConnection, [
                    document.notebookType as typeof JupyterNotebookView | typeof InteractiveWindowView
                ]);
                traceInfoIfCI(
                    `Controller for preferred connection ${preferredConnection.kind}${
                        preferredConnection.id
                    } for notebook ${getDisplayPath(document.uri)} does not yet exist, creating this now`
                );
                if (controller.length === 1) {
                    targetController = controller[0];
                } else {
                    traceError(
                        `Failed to create the controller for preferred connection ${preferredConnection.kind}${
                            preferredConnection.id
                        } for notebook ${getDisplayPath(document.uri)}`
                    );
                }
            }
            traceInfoIfCI(
                `TargetController found ID: ${preferredConnection?.id} type ${
                    preferredConnection?.kind
                } for document ${getDisplayPath(document.uri)} & associated controller id ${
                    targetController?.connection?.kind
                }:${targetController?.id}`
            );

            return { preferredConnection, controller: targetController };
        } catch (ex) {
            traceError('Failed to find & set preferred controllers', ex);
            return {};
        } finally {
            if (changeHandler) {
                changeHandler.dispose();
                this.disposables.delete(changeHandler);
            }
            preferredSearchToken.dispose();
            this.disposables.delete(preferredSearchToken);
        }
    }

    public getPreferred(notebook: NotebookDocument) {
        return this.preferredControllers.get(notebook);
    }

    private readonly debouncedPreferredCompute = new WeakMap<NotebookDocument, IDisposable>();
    /**
     * When a document is opened we need to look for a preferred kernel for it
     */
    private onDidOpenNotebookDocument(document: NotebookDocument) {
        // Restrict to only our notebook documents
        if (
            (document.notebookType !== JupyterNotebookView && document.notebookType !== InteractiveWindowView) ||
            !workspace.isTrusted
        ) {
            return;
        }
        if (this.selection.getSelected(document)) {
            return;
        }

        // This method can get called very frequently, hence compute the preferred once in 100ms
        const cancellationToken = new CancellationTokenSource();
        const timeout = setTimeout(async () => {
            // Provide the preferred controller only after we've loaded all controllers
            // This avoids the kernel status label from flickering (i.e. changing from one to another).
            // E.g. connect to a remote jupyter server
            // Open a notebook with a kernel spec in the metadata
            // We might set active interpreter as preferred,
            // then change it to the local kernel spec.
            // Then change to remove kernel spec
            // Then change to the remote kernel session (assuming its still running).
            await this.loader.loaded.catch(noop);
            if (cancellationToken.token.isCancellationRequested) {
                return;
            }
            this.computePreferred(document, undefined, cancellationToken.token).catch(noop);
        }, 100);
        this.debouncedPreferredCompute.get(document)?.dispose();
        this.debouncedPreferredCompute.set(document, new Disposable(() => clearTimeout(timeout)));
        this.debouncedPreferredCompute.set(
            document,
            new Disposable(() => {
                clearTimeout(timeout);
                cancellationToken.cancel();
                cancellationToken.dispose();
            })
        );
    }

    // Use our kernel finder to rank our kernels, and see if we have an exact match
    private async findPreferredKernelExactMatch(
        notebook: NotebookDocument,
        notebookMetadata: INotebookMetadata | undefined,
        cancelToken: CancellationToken,
        preferredInterpreter: PythonEnvironment | undefined,
        serverId: string | undefined
    ): Promise<KernelConnectionMetadata | undefined> {
        const uri = notebook.uri;
        let preferredConnection: KernelConnectionMetadata | undefined;
        const rankedConnections = await this.kernelRankHelper.rankKernels(
            uri,
            this.registration.all,
            notebookMetadata,
            preferredInterpreter,
            cancelToken,
            serverId
        );
        if (cancelToken.isCancellationRequested) {
            return;
        }
        if (rankedConnections && rankedConnections.length) {
            const potentialMatch = rankedConnections[rankedConnections.length - 1];

            // Are we the only connection?
            const onlyConnection = rankedConnections.length === 1;

            // Is the top ranked connection the preferred interpreter?
            const topMatchIsPreferredInterpreter = await findKernelSpecMatchingInterpreter(preferredInterpreter, [
                potentialMatch
            ]);
            if (cancelToken.isCancellationRequested) {
                return;
            }

            // Are we an exact match based on metadata hash / name / ect...?
            const isExactMatch = await this.kernelRankHelper.isExactMatch(uri, potentialMatch, notebookMetadata);
            if (cancelToken.isCancellationRequested) {
                return;
            }
            if (!notebookMetadata || isPythonNotebook(notebookMetadata)) {
                // If we're looking for local kernel connections then wait for all interpreters have been loaded
                // & then fallback to the old approach of providing a best match.
                // We wait for all kernels to be discovered so that we can provide a good preferred kernel
                // instead of providing any kernel.
                // E.g. assume we have discovered one kernel, & we don't have an exact match,
                // then we fallback to the first found.
                // Later we find another, and this code runs again and we find that the new kernel is a better match
                // now we change the preferred to the new kernel
                // I.e. it could change a number of times, to avoid this we should wait for all kernels to be discovered
                // when we provide a fallback (when we don't have an exact match).
                if (!isExactMatch && this.extensionChecker.isPythonExtensionActive && !this.isWebExtension) {
                    await this.interpreters.refreshInterpreters();
                    // We don't really care too much about remotes, we know those are very slow to fetch kernels.
                    if (
                        this.kernelFinder.registered.some(
                            (f) => f.kind !== ContributedKernelFinderKind.Remote && f.status !== 'idle'
                        )
                    ) {
                        // We're still searching for kernels, hence don't provide a preferred kernel.
                        return;
                    }
                }
            }
            if (cancelToken.isCancellationRequested) {
                return;
            }

            // non-exact matches are ok for non-python kernels, else we revert to active interpreter for non-python kernels.
            const languageInNotebookMetadata = getLanguageInNotebookMetadata(notebookMetadata);
            const isNonPythonLanguageMatch =
                languageInNotebookMetadata &&
                languageInNotebookMetadata !== PYTHON_LANGUAGE &&
                getKernelConnectionLanguage(potentialMatch) === languageInNotebookMetadata;
            const isPythonLanguageMatch =
                languageInNotebookMetadata &&
                languageInNotebookMetadata === PYTHON_LANGUAGE &&
                getKernelConnectionLanguage(potentialMatch) === languageInNotebookMetadata;

            // Match on our possible reasons
            if (
                (onlyConnection && isPythonLanguageMatch) || // If we have only one Python controller and we have a Python nb opened, then use this as preferred
                topMatchIsPreferredInterpreter ||
                isExactMatch ||
                isNonPythonLanguageMatch
            ) {
                traceInfo(
                    `Preferred kernel ${potentialMatch.id} is exact match or top match for non python kernels, (${onlyConnection}, ${topMatchIsPreferredInterpreter}, ${isExactMatch}, ${isNonPythonLanguageMatch})`
                );
                preferredConnection = potentialMatch;
            }

            // Send telemetry on why we matched
            let matchReason: PreferredKernelExactMatchReason = PreferredKernelExactMatchReason.NoMatch;
            onlyConnection && (matchReason |= PreferredKernelExactMatchReason.OnlyKernel);
            topMatchIsPreferredInterpreter && (matchReason |= PreferredKernelExactMatchReason.WasPreferredInterpreter);
            isExactMatch && (matchReason |= PreferredKernelExactMatchReason.IsExactMatch);
            isNonPythonLanguageMatch && (matchReason |= PreferredKernelExactMatchReason.IsNonPythonKernelLanguageMatch);
            sendTelemetryEvent(Telemetry.PreferredKernelExactMatch, {
                matchedReason: matchReason
            });
        }

        return preferredConnection;
    }
    private sendPreferredKernelTelemetry(
        resource: Resource,
        notebookMetadata?: INotebookMetadata,
        preferredConnection?: KernelConnectionMetadata,
        preferredInterpreter?: PythonEnvironment
    ) {
        // Send telemetry on searching for a preferred connection
        const resourceType = getResourceType(resource);
        const language =
            resourceType === 'interactive' ? PYTHON_LANGUAGE : getLanguageInNotebookMetadata(notebookMetadata) || '';

        sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
            result: preferredConnection ? 'found' : 'notfound',
            resourceType,
            language: language,
            hasActiveInterpreter: !!preferredInterpreter
        });
    }
}
