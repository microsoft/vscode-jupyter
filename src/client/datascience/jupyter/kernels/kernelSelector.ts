// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { nbformat } from '@jupyterlab/coreutils';
import { sha256 } from 'hash.js';
import { inject, injectable } from 'inversify';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { CancellationToken } from 'vscode-jsonrpc';
import { IPythonExtensionChecker } from '../../../api/types';
import { IApplicationShell } from '../../../common/application/types';
import { PYTHON_LANGUAGE } from '../../../common/constants';
import '../../../common/extensions';
import { traceDecorators, traceError, traceInfo, traceInfoIf, traceVerbose } from '../../../common/logger';
import { IConfigurationService, ReadWrite, Resource } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { IInterpreterService } from '../../../interpreter/contracts';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { captureTelemetry, IEventNamePropertyMapping, sendTelemetryEvent } from '../../../telemetry';
import { getResourceType, sendNotebookOrKernelLanguageTelemetry } from '../../common';
import { Commands, Telemetry } from '../../constants';
import { sendKernelListTelemetry } from '../../context/kernelTelemetry';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../../context/telemetry';
import { IKernelFinder } from '../../kernel-launcher/types';
import { isPythonNotebook } from '../../notebook/helpers/helpers';
import { getInterpreterInfoStoredInMetadata } from '../../notebookStorage/baseModel';
import { PreferredRemoteKernelIdProvider } from '../../notebookStorage/preferredRemoteKernelIdProvider';
import { reportAction } from '../../progress/decorator';
import { ReportableAction } from '../../progress/types';
import {
    IJupyterConnection,
    IJupyterKernelSpec,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    IKernelDependencyService,
    INotebookProviderConnection,
    KernelInterpreterDependencyResponse
} from '../../types';
import {
    createDefaultKernelSpec,
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch,
    isPythonKernelConnection
} from './helpers';
import { KernelSelectionProvider } from './kernelSelections';
import { KernelService } from './kernelService';
import {
    DefaultKernelConnectionMetadata,
    IKernelSelectionUsage,
    IKernelSpecQuickPickItem,
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from './types';

/**
 * All KernelConnections returned (as return values of methods) by the KernelSelector can be used in a number of ways.
 * E.g. some part of the code update the `interpreter` property in the `KernelConnectionMetadata` object.
 * We need to ensure such changes (i.e. updates to the `KernelConnectionMetadata`) downstream do not change the original `KernelConnectionMetadata`.
 * Hence always clone the `KernelConnectionMetadata` returned by the `kernelSelector`.
 */
@injectable()
export class KernelSelector implements IKernelSelectionUsage {
    constructor(
        @inject(KernelSelectionProvider) private readonly selectionProvider: KernelSelectionProvider,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(KernelService) private readonly kernelService: KernelService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IKernelDependencyService) private readonly kernelDependencyService: IKernelDependencyService,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider
    ) {}

    /**
     * Selects a kernel from a remote session.
     */
    public async selectRemoteKernel(
        resource: Resource,
        stopWatch: StopWatch,
        sessionManagerCreator: () => Promise<IJupyterSessionManager>,
        cancelToken?: CancellationToken,
        currentKernelDisplayName?: string
    ): Promise<LiveKernelConnectionMetadata | KernelSpecConnectionMetadata | undefined> {
        const suggestions = await this.selectionProvider.getKernelSelectionsForRemoteSession(
            resource,
            sessionManagerCreator,
            cancelToken
        );
        const selection = await this.selectKernel<LiveKernelConnectionMetadata | KernelSpecConnectionMetadata>(
            resource,
            'jupyter',
            stopWatch,
            Telemetry.SelectRemoteJupyterKernel,
            suggestions,
            cancelToken,
            currentKernelDisplayName
        );
        return cloneDeep(selection);
    }
    /**
     * Select a kernel from a local session.
     */
    public async selectLocalKernel(
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        stopWatch: StopWatch,
        cancelToken?: CancellationToken,
        currentKernelDisplayName?: string
    ): Promise<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata | undefined> {
        const suggestions = await this.selectionProvider.getKernelSelectionsForLocalSession(resource, cancelToken);
        const selection = await this.selectKernel<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata>(
            resource,
            type,
            stopWatch,
            Telemetry.SelectLocalJupyterKernel,
            suggestions,
            cancelToken,
            currentKernelDisplayName
        );
        return cloneDeep(selection);
    }
    /**
     * Gets a kernel that needs to be used with a local session.
     * (will attempt to find the best matching kernel, or prompt user to use current interpreter or select one).
     */
    @traceDecorators.info('Get preferred local kernel connection')
    @reportAction(ReportableAction.KernelsGetKernelForLocalConnection)
    @captureTelemetry(Telemetry.GetPreferredKernelPerf)
    public async getPreferredKernelForLocalConnection(
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        notebookMetadata?: nbformat.INotebookMetadata,
        disableUI?: boolean,
        cancelToken?: CancellationToken,
        ignoreDependencyCheck?: boolean
    ): Promise<
        KernelSpecConnectionMetadata | PythonKernelConnectionMetadata | DefaultKernelConnectionMetadata | undefined
    > {
        const stopWatch = new StopWatch();
        const telemetryProps: IEventNamePropertyMapping[Telemetry.FindKernelForLocalConnection] = {
            kernelSpecFound: false,
            interpreterFound: false,
            promptedToSelect: false
        };
        // When this method is called, we know we've started a local jupyter server or are connecting raw
        // Lets pre-warm the list of local kernels.
        if (this.extensionChecker.isPythonExtensionInstalled) {
            this.selectionProvider.getKernelSelectionsForLocalSession(resource, cancelToken).ignoreErrors();
        }

        let selection:
            | KernelSpecConnectionMetadata
            | PythonKernelConnectionMetadata
            | DefaultKernelConnectionMetadata
            | undefined;

        if (type === 'jupyter') {
            selection = await this.getKernelForLocalJupyterConnection(
                resource,
                stopWatch,
                telemetryProps,
                notebookMetadata,
                disableUI,
                cancelToken
            );
        } else if (type === 'raw') {
            selection = await this.getKernelForLocalRawConnection(
                resource,
                notebookMetadata,
                cancelToken,
                ignoreDependencyCheck
            );
        }

        // If still not found, log an error (this seems possible for some people, so use the default)
        if (!selection || !selection.kernelSpec) {
            traceError('Jupyter Kernel Spec not found for a local connection');
        }

        telemetryProps.kernelSpecFound = !!selection?.kernelSpec;
        telemetryProps.interpreterFound = !!selection?.interpreter;
        sendTelemetryEvent(Telemetry.FindKernelForLocalConnection, stopWatch.elapsedTime, telemetryProps);
        if (
            selection &&
            !selection.interpreter &&
            isPythonKernelConnection(selection) &&
            selection.kind === 'startUsingKernelSpec'
        ) {
            const itemToReturn = cloneDeep(selection) as ReadWrite<
                KernelSpecConnectionMetadata | PythonKernelConnectionMetadata | DefaultKernelConnectionMetadata
            >;
            itemToReturn.interpreter =
                itemToReturn.interpreter ||
                (this.extensionChecker.isPythonExtensionInstalled
                    ? await this.kernelService.findMatchingInterpreter(selection.kernelSpec, cancelToken)
                    : undefined);
            if (itemToReturn.kernelSpec) {
                itemToReturn.kernelSpec.interpreterPath =
                    itemToReturn.kernelSpec.interpreterPath || itemToReturn.interpreter?.path;
            }
            return itemToReturn;
        }
        return selection;
    }

    /**
     * Gets a kernel that needs to be used with a remote session.
     * (will attempt to find the best matching kernel, or prompt user to use current interpreter or select one).
     */
    // eslint-disable-next-line complexity
    @traceDecorators.info('Get preferred remote kernel connection')
    @reportAction(ReportableAction.KernelsGetKernelForRemoteConnection)
    public async getPreferredKernelForRemoteConnection(
        resource: Resource,
        sessionManager?: IJupyterSessionManager,
        notebookMetadata?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        const [interpreter, specs, sessions] = await Promise.all([
            this.extensionChecker.isPythonExtensionInstalled
                ? this.interpreterService.getActiveInterpreter(resource)
                : Promise.resolve(undefined),
            this.kernelService.getKernelSpecs(sessionManager, cancelToken),
            sessionManager?.getRunningSessions()
        ]);

        // First check for a live active session.
        const preferredKernelId = resource
            ? this.preferredRemoteKernelIdProvider.getPreferredRemoteKernelId(resource)
            : undefined;
        if (preferredKernelId) {
            const session = sessions?.find((s) => s.kernel.id === preferredKernelId);
            if (session) {
                traceInfo(
                    `Got Preferred kernel for ${resource?.toString()} & it is ${preferredKernelId} & found a matching session`
                );
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const liveKernel = session.kernel as any;
                const lastActivityTime = liveKernel.last_activity
                    ? new Date(Date.parse(liveKernel.last_activity.toString()))
                    : new Date();
                const numberOfConnections = liveKernel.connections
                    ? parseInt(liveKernel.connections.toString(), 10)
                    : 0;
                return cloneDeep({
                    kernelModel: { ...session.kernel, lastActivityTime, numberOfConnections, session },
                    interpreter: interpreter,
                    kind: 'connectToLiveKernel'
                });
            } else {
                traceInfo(
                    `Got Preferred kernel for ${resource?.toString()} & it is ${preferredKernelId}, but without a matching session`
                );
            }
        } else {
            traceInfo(`No preferred kernel for remote notebook connection ${resource?.toString()}`);
        }

        // No running session, try matching based on interpreter
        let bestMatch: IJupyterKernelSpec | undefined;
        let bestScore = -1;
        for (let i = 0; specs && i < specs?.length; i = i + 1) {
            const spec = specs[i];
            let score = 0;

            if (spec) {
                // See if the path matches.
                if (spec && spec.path && spec.path.length > 0 && interpreter && spec.path === interpreter.path) {
                    // Path match
                    score += 8;
                }

                // See if the version is the same
                if (interpreter && interpreter.version && spec && spec.name) {
                    // Search for a digit on the end of the name. It should match our major version
                    const match = /\D+(\d+)/.exec(spec.name);
                    if (match && match !== null && match.length > 0) {
                        // See if the version number matches
                        const nameVersion = parseInt(match[1][0], 10);
                        if (nameVersion && nameVersion === interpreter.version.major) {
                            score += 4;
                        }
                    }
                }

                // See if the display name already matches.
                if (spec.display_name && spec.display_name === notebookMetadata?.kernelspec?.display_name) {
                    score += 16;
                }

                // Find a kernel spec that matches the language in the notebook metadata.
                const nbMetadataLanguage = isPythonNotebook(notebookMetadata)
                    ? PYTHON_LANGUAGE
                    : (notebookMetadata?.kernelspec?.language as string) || notebookMetadata?.language_info?.name;
                if (score === 0 && spec.language?.toLowerCase() === (nbMetadataLanguage || '').toLowerCase()) {
                    score = 1;
                }
            }

            if (score > bestScore) {
                bestMatch = spec;
                bestScore = score;
            }
        }
        if (bestMatch) {
            return cloneDeep({
                kernelSpec: bestMatch,
                interpreter: interpreter,
                kind: 'startUsingKernelSpec'
            });
        } else {
            traceError('No preferred kernel, using the default kernel');
            // Unlikely scenario, we expect there to be at least one kernel spec.
            // Either way, return so that we can start using the default kernel.
            return cloneDeep({
                interpreter: interpreter,
                kind: 'startUsingDefaultKernel'
            });
        }
    }
    public async useSelectedKernel(
        selection: KernelConnectionMetadata,
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<KernelConnectionMetadata | undefined> {
        // Check if ipykernel is installed in this kernel.
        if (selection.interpreter && type === 'jupyter' && !disableUI) {
            sendTelemetryEvent(Telemetry.SwitchToInterpreterAsKernel);
            const item = await this.useInterpreterAsKernel(
                resource,
                selection.interpreter,
                undefined,
                false,
                cancelToken
            );
            return cloneDeep(item);
        } else if (selection.kind === 'connectToLiveKernel') {
            sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, selection.kernelModel.language);
            const interpreter = selection.interpreter
                ? selection.interpreter
                : selection.kernelModel && this.extensionChecker.isPythonExtensionInstalled
                ? await this.kernelService.findMatchingInterpreter(selection.kernelModel, cancelToken)
                : undefined;
            return cloneDeep({
                interpreter,
                kernelModel: selection.kernelModel,
                kind: 'connectToLiveKernel'
            });
        } else if (selection.kernelSpec) {
            sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, selection.kernelSpec.language);
            const interpreter = selection.interpreter
                ? selection.interpreter
                : selection.kernelSpec && this.extensionChecker.isPythonExtensionInstalled
                ? await this.kernelService.findMatchingInterpreter(selection.kernelSpec, cancelToken)
                : undefined;
            await this.kernelService.updateKernelEnvironment(interpreter, selection.kernelSpec, cancelToken);
            return cloneDeep({ kernelSpec: selection.kernelSpec, interpreter, kind: 'startUsingKernelSpec' });
        } else if (selection.interpreter && type === 'raw') {
            const item = await this.useInterpreterAndDefaultKernel(selection.interpreter);
            return cloneDeep(item);
        } else {
            return;
        }
    }
    public async askForLocalKernel(
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        kernelConnection?: KernelConnectionMetadata
    ): Promise<KernelConnectionMetadata | undefined> {
        const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
        const message = localize.DataScience.sessionStartFailedWithKernel().format(
            displayName,
            Commands.ViewJupyterOutput
        );
        const selectKernel = localize.DataScience.selectDifferentKernel();
        const cancel = localize.Common.cancel();
        const selection = await this.applicationShell.showErrorMessage(message, selectKernel, cancel);
        if (selection === selectKernel) {
            const item = await this.selectLocalJupyterKernel(resource, type, displayName);
            return cloneDeep(item);
        }
    }
    public async selectJupyterKernel(
        resource: Resource,
        connection: INotebookProviderConnection | undefined,
        type: 'raw' | 'jupyter',
        currentKernelDisplayName: string | undefined
    ): Promise<KernelConnectionMetadata | undefined> {
        let kernelConnection: KernelConnectionMetadata | undefined;
        const isLocalConnection = connection?.localLaunch ?? isLocalLaunch(this.configService);

        if (isLocalConnection) {
            kernelConnection = await this.selectLocalJupyterKernel(
                resource,
                connection?.type || type,
                currentKernelDisplayName
            );
        } else if (connection && connection.type === 'jupyter') {
            kernelConnection = await this.selectRemoteJupyterKernel(resource, connection, currentKernelDisplayName);
        }
        return cloneDeep(kernelConnection);
    }

    private async selectLocalJupyterKernel(
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        currentKernelDisplayName: string | undefined
    ): Promise<KernelConnectionMetadata | undefined> {
        return this.selectLocalKernel(resource, type, new StopWatch(), undefined, currentKernelDisplayName);
    }

    private async selectRemoteJupyterKernel(
        resource: Resource,
        connInfo: IJupyterConnection,
        currentKernelDisplayName?: string
    ): Promise<KernelConnectionMetadata | undefined> {
        const stopWatch = new StopWatch();
        const sessionManagerCreator = () => this.jupyterSessionManagerFactory.create(connInfo);
        return this.selectRemoteKernel(resource, stopWatch, sessionManagerCreator, undefined, currentKernelDisplayName);
    }

    // Get our kernelspec and matching interpreter for a connection to a local jupyter server
    private async getKernelForLocalJupyterConnection(
        resource: Resource,
        stopWatch: StopWatch,
        telemetryProps: IEventNamePropertyMapping[Telemetry.FindKernelForLocalConnection],
        notebookMetadata?: nbformat.INotebookMetadata,
        disableUI?: boolean,
        cancelToken?: CancellationToken
    ): Promise<
        KernelSpecConnectionMetadata | PythonKernelConnectionMetadata | DefaultKernelConnectionMetadata | undefined
    > {
        if (notebookMetadata?.kernelspec) {
            const kernelSpec = await this.kernelFinder.findKernelSpec(resource, notebookMetadata, cancelToken);
            if (kernelSpec) {
                const interpreter = await this.kernelService.findMatchingInterpreter(kernelSpec, cancelToken);
                sendTelemetryEvent(Telemetry.UseExistingKernel);

                // Make sure we update the environment in the kernel before using it
                await this.kernelService.updateKernelEnvironment(interpreter, kernelSpec, cancelToken);
                return { kind: 'startUsingKernelSpec', interpreter, kernelSpec };
            } else if (!cancelToken?.isCancellationRequested) {
                // No kernel info, hence prompt to use current interpreter as a kernel.
                const activeInterpreter = await this.interpreterService.getActiveInterpreter(resource);
                if (activeInterpreter && !disableUI) {
                    return this.useInterpreterAsKernel(
                        resource,
                        activeInterpreter,
                        notebookMetadata.kernelspec.display_name,
                        disableUI,
                        cancelToken
                    );
                } else if (activeInterpreter) {
                    // No UI allowed, just use the default kernel
                    return { kind: 'startUsingDefaultKernel', interpreter: activeInterpreter };
                } else {
                    telemetryProps.promptedToSelect = true;
                    return this.selectLocalKernel(resource, 'jupyter', stopWatch, cancelToken);
                }
            }
        } else if (!cancelToken?.isCancellationRequested) {
            // No kernel info, hence use current interpreter as a kernel.
            const activeInterpreter = await this.interpreterService.getActiveInterpreter(resource);
            if (activeInterpreter && !disableUI) {
                const kernelSpec = await this.kernelService.searchAndRegisterKernel(
                    resource,
                    activeInterpreter,
                    disableUI,
                    cancelToken
                );
                if (kernelSpec) {
                    return { kind: 'startUsingKernelSpec', kernelSpec, interpreter: activeInterpreter };
                } else {
                    return { kind: 'startUsingDefaultKernel', interpreter: activeInterpreter };
                }
            }
        }
    }
    private async findInterpreterStoredInNotebookMetadata(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata
    ): Promise<PythonEnvironment | undefined> {
        const info = getInterpreterInfoStoredInMetadata(notebookMetadata);
        if (!info || !this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        const interpreters = await this.interpreterService.getInterpreters(resource);
        return interpreters.find((item) => sha256().update(item.path).digest('hex') === info.hash);
    }
    /**
     * Get our kernelspec and interpreter for a local raw connection
     */
    @traceDecorators.verbose('Find kernel spec')
    private async getKernelForLocalRawConnection(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken,
        ignoreDependencyCheck?: boolean
    ): Promise<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata | undefined> {
        // If user had selected an interpreter (raw kernel), then that interpreter would be stored in the kernelspec metadata.
        // Find this matching interpreter & start that using raw kernel.
        const interpreterStoredInKernelSpec = await this.findInterpreterStoredInNotebookMetadata(
            resource,
            notebookMetadata
        );
        if (interpreterStoredInKernelSpec) {
            const connectionInfo: PythonKernelConnectionMetadata = {
                kind: 'startUsingPythonInterpreter',
                interpreter: interpreterStoredInKernelSpec
            };
            // Install missing dependencies only if we're dealing with a Python kernel.
            if (interpreterStoredInKernelSpec && isPythonKernelConnection(connectionInfo)) {
                await this.installDependenciesIntoInterpreter(
                    interpreterStoredInKernelSpec,
                    ignoreDependencyCheck,
                    cancelToken
                );
            }
            return connectionInfo;
        }

        // First use our kernel finder to locate a kernelspec on disk
        const kernelSpec = await this.kernelFinder.findKernelSpec(resource, notebookMetadata, cancelToken);
        traceInfoIf(
            !!process.env.VSC_JUPYTER_FORCE_LOGGING,
            `Kernel spec found ${JSON.stringify(kernelSpec)}, metadata ${JSON.stringify(notebookMetadata || '')}`
        );
        const isNonPythonKernelSPec = kernelSpec?.language && kernelSpec.language !== PYTHON_LANGUAGE ? true : false;
        const activeInterpreter = this.extensionChecker.isPythonExtensionInstalled
            ? await this.interpreterService.getActiveInterpreter(resource)
            : undefined;
        if (!kernelSpec && activeInterpreter) {
            await this.installDependenciesIntoInterpreter(activeInterpreter, ignoreDependencyCheck, cancelToken);

            // Return current interpreter.
            return {
                kind: 'startUsingPythonInterpreter',
                interpreter: activeInterpreter
            };
        } else if (kernelSpec) {
            // Locate the interpreter that matches our kernelspec (but don't look for interpreter if kernelspec is Not Python).
            const interpreter =
                this.extensionChecker.isPythonExtensionInstalled && !isNonPythonKernelSPec
                    ? await this.kernelService.findMatchingInterpreter(kernelSpec, cancelToken)
                    : undefined;

            const connectionInfo: KernelSpecConnectionMetadata = {
                kind: 'startUsingKernelSpec',
                kernelSpec,
                interpreter
            };
            // Install missing dependencies only if we're dealing with a Python kernel.
            if (interpreter && isPythonKernelConnection(connectionInfo)) {
                await this.installDependenciesIntoInterpreter(interpreter, ignoreDependencyCheck, cancelToken);
            }
            return connectionInfo;
        } else {
            // No kernel specs, list them all and pick the first one
            const kernelSpecs = await this.kernelFinder.listKernelSpecs(resource);

            // Do a bit of hack and pick a python one first if the resource is a python file
            // Or if its a python notebook.
            if (isPythonNotebook(notebookMetadata) || (resource?.fsPath && resource.fsPath.endsWith('.py'))) {
                const firstPython = kernelSpecs.find((k) => k.language === 'python');
                if (firstPython) {
                    return { kind: 'startUsingKernelSpec', kernelSpec: firstPython, interpreter: undefined };
                }
            }

            // If that didn't work, just pick the first one
            if (kernelSpecs.length > 0) {
                return { kind: 'startUsingKernelSpec', kernelSpec: kernelSpecs[0], interpreter: undefined };
            }
        }
    }

    private async selectKernel<T extends KernelConnectionMetadata>(
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        stopWatch: StopWatch,
        telemetryEvent: Telemetry,
        suggestions: IKernelSpecQuickPickItem<T>[],
        cancelToken?: CancellationToken,
        currentKernelDisplayName?: string
    ) {
        const placeHolder =
            localize.DataScience.selectKernel() +
            (currentKernelDisplayName ? ` (current: ${currentKernelDisplayName})` : '');
        sendTelemetryEvent(telemetryEvent, stopWatch.elapsedTime);
        sendKernelListTelemetry(resource, suggestions, stopWatch);
        const selection = await this.applicationShell.showQuickPick(suggestions, { placeHolder }, cancelToken);
        if (!selection?.selection) {
            return;
        }
        trackKernelResourceInformation(resource, {
            kernelConnection: selection.selection,
            kernelConnectionChanged: true
        });
        sendKernelTelemetryEvent(resource, Telemetry.SwitchKernel);
        return (this.useSelectedKernel(selection.selection, resource, type, cancelToken) as unknown) as T | undefined;
    }

    // When switching to an interpreter in raw kernel mode then just create a default kernelspec for that interpreter to use
    private async useInterpreterAndDefaultKernel(interpreter: PythonEnvironment): Promise<KernelConnectionMetadata> {
        const kernelSpec = createDefaultKernelSpec(interpreter);
        return { kernelSpec, interpreter, kind: 'startUsingPythonInterpreter' };
    }

    // If we need to install our dependencies now (for non-native scenarios)
    // then install ipykernel into the interpreter or throw error
    private async installDependenciesIntoInterpreter(
        interpreter: PythonEnvironment,
        ignoreDependencyCheck?: boolean,
        cancelToken?: CancellationToken
    ) {
        if (!ignoreDependencyCheck) {
            if (
                (await this.kernelDependencyService.installMissingDependencies(interpreter, cancelToken)) !==
                KernelInterpreterDependencyResponse.ok
            ) {
                throw new Error(
                    localize.DataScience.ipykernelNotInstalled().format(
                        `${interpreter.displayName || interpreter.path}:${interpreter.path}`
                    )
                );
            }
        }
    }

    /**
     * Use the provided interpreter as a kernel.
     * If `displayNameOfKernelNotFound` is provided, then display a message indicating we're using the `current interpreter`.
     * This would happen when we're starting a notebook.
     * Otherwise, if not provided user is changing the kernel after starting a notebook.
     */
    private async useInterpreterAsKernel(
        resource: Resource,
        interpreter: PythonEnvironment,
        displayNameOfKernelNotFound?: string,
        disableUI?: boolean,
        cancelToken?: CancellationToken
    ): Promise<KernelSpecConnectionMetadata | undefined> {
        let kernelSpec: IJupyterKernelSpec | undefined;

        if (await this.kernelDependencyService.areDependenciesInstalled(interpreter, cancelToken)) {
            // Find the kernel associated with this interpreter.
            kernelSpec = await this.kernelFinder.findKernelSpec(resource, interpreter, cancelToken);

            if (kernelSpec) {
                traceVerbose(`ipykernel installed in ${interpreter.path}, and matching kernelspec found.`);
                // Make sure the environment matches.
                await this.kernelService.updateKernelEnvironment(interpreter, kernelSpec, cancelToken);

                // Notify the UI that we didn't find the initially requested kernel and are just using the active interpreter
                if (displayNameOfKernelNotFound && !disableUI) {
                    this.applicationShell
                        .showInformationMessage(
                            localize.DataScience.fallbackToUseActiveInterpreterAsKernel().format(
                                displayNameOfKernelNotFound
                            )
                        )
                        .then(noop, noop);
                }

                sendTelemetryEvent(Telemetry.UseInterpreterAsKernel);
                return { kind: 'startUsingKernelSpec', kernelSpec, interpreter };
            }
            traceInfo(`ipykernel installed in ${interpreter.path}, no matching kernel found. Will register kernel.`);
        }

        // Try an install this interpreter as a kernel.
        try {
            kernelSpec = await this.kernelService.registerKernel(resource, interpreter, disableUI, cancelToken);
        } catch (e) {
            sendTelemetryEvent(Telemetry.KernelRegisterFailed);
            throw e;
        }

        // If we have a display name of a kernel that could not be found,
        // then notify user that we're using current interpreter instead.
        if (displayNameOfKernelNotFound && !disableUI) {
            this.applicationShell
                .showInformationMessage(
                    localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel().format(
                        displayNameOfKernelNotFound
                    )
                )
                .then(noop, noop);
        }

        // When this method is called, we know a new kernel may have been registered.
        // Lets pre-warm the list of local kernels (with the new list).
        this.selectionProvider.getKernelSelectionsForLocalSession(resource, cancelToken).ignoreErrors();

        if (kernelSpec) {
            return { kind: 'startUsingKernelSpec', kernelSpec, interpreter };
        }
    }
}
