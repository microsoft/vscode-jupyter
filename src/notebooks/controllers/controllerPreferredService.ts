// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { INotebookMetadata } from '@jupyterlab/nbformat';
import { injectable, inject } from 'inversify';
import {
    CancellationToken,
    CancellationTokenSource,
    NotebookControllerAffinity,
    NotebookDocument,
    Uri,
    workspace
} from 'vscode';
import { getKernelConnectionLanguage, getLanguageInNotebookMetadata, isPythonNotebook } from '../../kernels/helpers';
import { IServerConnectionType } from '../../kernels/jupyter/types';
import { trackKernelResourceInformation } from '../../kernels/telemetry/helper';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import {
    JupyterNotebookView,
    InteractiveWindowView,
    PYTHON_LANGUAGE,
    Telemetry
} from '../../platform/common/constants';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IDisposableRegistry, Resource } from '../../platform/common/types';
import { getNotebookMetadata, getResourceType } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { traceError, traceInfo, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { getTelemetrySafeLanguage } from '../../platform/telemetry/helpers';
import { sendTelemetryEvent } from '../../telemetry';
import { findKernelSpecMatchingInterpreter } from './kernelRanking/helpers';
import {
    IControllerDefaultService,
    IControllerLoader,
    IControllerPreferredService,
    IControllerRegistration,
    IKernelRankingHelper,
    IVSCodeNotebookController,
    PreferredKernelExactMatchReason
} from './types';

/**
 * Computes and tracks the preferred kernel for a notebook.
 * Preferred is determined from the metadata in the notebook. If no metadata is found, the default kernel is used.
 */
@injectable()
export class ControllerPreferredService implements IControllerPreferredService, IExtensionSingleActivationService {
    private preferredControllers = new Map<NotebookDocument, IVSCodeNotebookController>();
    private preferredCancelTokens = new Map<NotebookDocument, CancellationTokenSource>();
    private get isLocalLaunch(): boolean {
        return this.serverConnectionType.isLocalLaunch;
    }
    constructor(
        @inject(IControllerRegistration) private readonly registration: IControllerRegistration,
        @inject(IControllerLoader) private readonly loader: IControllerLoader,
        @inject(IControllerDefaultService) private readonly defaultService: IControllerDefaultService,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IServerConnectionType) private readonly serverConnectionType: IServerConnectionType,
        @inject(IKernelRankingHelper) private readonly kernelRankHelper: IKernelRankingHelper
    ) {}
    public async activate() {
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook));
        this.notebook.onDidCloseNotebookDocument((document) => {
            const token = this.preferredCancelTokens.get(document);
            if (token) {
                this.preferredCancelTokens.delete(document);
                token.cancel();
            }
        });
    }
    public async computePreferred(
        document: NotebookDocument,
        serverId?: string | undefined
    ): Promise<{
        preferredConnection?: KernelConnectionMetadata | undefined;
        controller?: IVSCodeNotebookController | undefined;
    }> {
        traceInfoIfCI(`Clear controller mapping for ${getDisplayPath(document.uri)}`);
        // Keep track of a token per document so that we can cancel the search if the doc is closed
        const preferredSearchToken = new CancellationTokenSource();
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
                preferredConnection = defaultPythonController?.connection;
            }
            if (document.notebookType === JupyterNotebookView && !preferredConnection) {
                const preferredInterpreter =
                    !serverId && isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                        ? await this.interpreters.getActiveInterpreter(document.uri)
                        : undefined;

                // Await looking for the preferred kernel
                ({ preferredConnection } = await this.findPreferredKernelExactMatch(
                    document.uri,
                    notebookMetadata,
                    preferredSearchToken.token,
                    'useCache',
                    preferredInterpreter,
                    serverId
                ));

                // If we didn't find an exact match in the cache, try awaiting for the non-cache version
                if (!preferredConnection) {
                    // Don't start this ahead of time to save some CPU cycles
                    ({ preferredConnection } = await this.findPreferredKernelExactMatch(
                        document.uri,
                        notebookMetadata,
                        preferredSearchToken.token,
                        'ignoreCache',
                        preferredInterpreter,
                        serverId
                    ));
                }

                // Send telemetry on looking for preferred don't await for sending it
                this.sendPreferredKernelTelemetry(
                    document.uri,
                    notebookMetadata,
                    preferredConnection,
                    preferredInterpreter
                ).ignoreErrors();

                // If we found a preferred kernel, set the association on the NotebookController
                if (preferredSearchToken.token.isCancellationRequested && !preferredConnection) {
                    traceInfo('Find preferred kernel cancelled');
                    return {};
                }
                if (!preferredConnection) {
                    traceInfoIfCI(
                        `PreferredConnection not found for NotebookDocument: ${getDisplayPath(document.uri)}`
                    );
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
                    this.registration.add(preferredConnection, [JupyterNotebookView]);
                }
            } else if (document.notebookType === InteractiveWindowView) {
                // Wait for our controllers to be loaded before we try to set a preferred on
                // can happen if a document is opened quick and we have not yet loaded our controllers
                await this.loader.loaded;

                // For interactive set the preferred controller as the interpreter or default
                const defaultInteractiveController = await this.defaultService.computeDefaultController(
                    document.uri,
                    'interactive'
                );
                preferredConnection = defaultInteractiveController?.connection;
            }

            // See if the preferred connection is in our registered controllers, add the sufix for the interactive scenario
            let targetController;
            if (preferredConnection) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                targetController = this.registration.get(preferredConnection, document.notebookType as any);
            }

            if (targetController) {
                traceVerbose(
                    `TargetController found ID: ${targetController.id} for document ${getDisplayPath(document.uri)}`
                );
                await targetController.controller.updateNotebookAffinity(
                    document,
                    NotebookControllerAffinity.Preferred
                );

                trackKernelResourceInformation(document.uri, {
                    kernelConnection: preferredConnection,
                    isPreferredKernel: true
                });

                // Save in our map so we can find it in test code.
                this.preferredControllers.set(document, targetController);
            } else {
                traceInfoIfCI(
                    `TargetController not found ID: ${preferredConnection?.id} for document ${getDisplayPath(
                        document.uri
                    )}`
                );
            }

            return { preferredConnection, controller: targetController };
        } catch (ex) {
            traceError('Failed to find & set preferred controllers', ex);
            return {};
        }
    }

    public getPreferred(notebook: NotebookDocument) {
        return this.preferredControllers.get(notebook);
    }

    // When a document is opened we need to look for a preferred kernel for it
    private onDidOpenNotebookDocument(document: NotebookDocument) {
        // Restrict to only our notebook documents
        if (
            (document.notebookType !== JupyterNotebookView && document.notebookType !== InteractiveWindowView) ||
            !workspace.isTrusted
        ) {
            return;
        }

        this.computePreferred(document).catch(noop);
    }

    // Use our kernel finder to rank our kernels, and see if we have an exact match
    private async findPreferredKernelExactMatch(
        uri: Uri,
        notebookMetadata: INotebookMetadata | undefined,
        cancelToken: CancellationToken,
        useCache: 'useCache' | 'ignoreCache' | undefined,
        preferredInterpreter: PythonEnvironment | undefined,
        serverId: string | undefined
    ): Promise<{
        rankedConnections: KernelConnectionMetadata[] | undefined;
        preferredConnection: KernelConnectionMetadata | undefined;
    }> {
        let preferredConnection: KernelConnectionMetadata | undefined;
        const rankedConnections = await this.kernelRankHelper.rankKernels(
            uri,
            notebookMetadata,
            preferredInterpreter,
            cancelToken,
            useCache,
            serverId
        );

        if (rankedConnections && rankedConnections.length) {
            const potentialMatch = rankedConnections[rankedConnections.length - 1];

            // Are we the only connection?
            const onlyConnection = rankedConnections.length === 1;

            // Is the top ranked connection the preferred interpreter?
            const topMatchIsPreferredInterpreter = findKernelSpecMatchingInterpreter(preferredInterpreter, [
                potentialMatch
            ]);

            // Are we an exact match based on metadata hash / name / ect...?
            const isExactMatch = this.kernelRankHelper.isExactMatch(uri, potentialMatch, notebookMetadata);

            // non-exact matches are ok for non-python kernels, else we revert to active interpreter for non-python kernels.
            const languageInNotebookMetadata = getLanguageInNotebookMetadata(notebookMetadata);
            const isNonPythonLanguageMatch =
                languageInNotebookMetadata &&
                languageInNotebookMetadata !== PYTHON_LANGUAGE &&
                getKernelConnectionLanguage(potentialMatch) === languageInNotebookMetadata;

            // Match on our possible reasons
            if (onlyConnection || topMatchIsPreferredInterpreter || isExactMatch || isNonPythonLanguageMatch) {
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
            sendTelemetryEvent(Telemetry.PreferredKernelExactMatch, undefined, {
                matchedReason: matchReason
            });
        }

        return { rankedConnections, preferredConnection };
    }
    private async sendPreferredKernelTelemetry(
        resource: Resource,
        notebookMetadata?: INotebookMetadata,
        preferredConnection?: KernelConnectionMetadata,
        preferredInterpreter?: PythonEnvironment
    ) {
        // Send telemetry on searching for a preferred connection
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');

        sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
            result: preferredConnection ? 'found' : 'notfound',
            resourceType,
            language: telemetrySafeLanguage,
            hasActiveInterpreter: !!preferredInterpreter
        });
    }
}
