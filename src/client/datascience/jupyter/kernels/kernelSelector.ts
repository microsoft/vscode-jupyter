// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { CancellationToken } from 'vscode-jsonrpc';
import { IPythonExtensionChecker } from '../../../api/types';
import { IApplicationShell } from '../../../common/application/types';
import '../../../common/extensions';
import { IConfigurationService, Resource } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { sendNotebookOrKernelLanguageTelemetry } from '../../common';
import { Commands, Telemetry } from '../../constants';
import { sendKernelListTelemetry } from '../../telemetry/kernelTelemetry';
import { sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import { INotebookProviderConnection } from '../../types';
import { createDefaultKernelSpec, getDisplayNameOrNameOfKernelConnection, isLocalLaunch } from './helpers';
import { KernelSelectionProvider } from './kernelSelections';
import { KernelService } from './kernelService';
import {
    IKernelSpecQuickPickItem,
    KernelConnectionMetadata} from './types';
import { InterpreterPackages } from '../../telemetry/interpreterPackages';

/**
 * All KernelConnections returned (as return values of methods) by the KernelSelector can be used in a number of ways.
 * E.g. some part of the code update the `interpreter` property in the `KernelConnectionMetadata` object.
 * We need to ensure such changes (i.e. updates to the `KernelConnectionMetadata`) downstream do not change the original `KernelConnectionMetadata`.
 * Hence always clone the `KernelConnectionMetadata` returned by the `kernelSelector`.
 */
@injectable()
export class KernelSelector {
    constructor(
        @inject(KernelSelectionProvider) private readonly selectionProvider: KernelSelectionProvider,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(KernelService) private readonly kernelService: KernelService,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(InterpreterPackages) private readonly interpreterPackages: InterpreterPackages
    ) {}

    /**
     * Selects a kernel from a remote session.
     */
    public async selectRemoteKernel(
        resource: Resource,
        stopWatch: StopWatch,
        connInfo: INotebookProviderConnection | undefined,
        cancelToken?: CancellationToken,
        currentKernelDisplayName?: string
    ): Promise<KernelConnectionMetadata | undefined> {
        const suggestions = await this.selectionProvider.getKernelSelections(resource, connInfo, cancelToken);
        const selection = await this.selectKernel(
            resource,
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
        stopWatch: StopWatch,
        connInfo: INotebookProviderConnection | undefined,
        cancelToken?: CancellationToken,
        currentKernelDisplayName?: string
    ): Promise<KernelConnectionMetadata | undefined> {
        const suggestions = await this.selectionProvider.getKernelSelections(resource, connInfo, cancelToken);
        const selection = await this.selectKernel(
            resource,
            stopWatch,
            Telemetry.SelectLocalJupyterKernel,
            suggestions,
            cancelToken,
            currentKernelDisplayName
        );
        if (selection?.interpreter) {
            this.interpreterPackages.trackPackages(selection.interpreter);
        }
        return cloneDeep(selection);
    }

    public async askForLocalKernel(
        resource: Resource,
        connection: INotebookProviderConnection | undefined,
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
            const item = await this.selectLocalJupyterKernel(resource, connection, displayName);
            return cloneDeep(item);
        }
    }
    public async selectJupyterKernel(
        resource: Resource,
        connection: INotebookProviderConnection | undefined,
        currentKernelDisplayName: string | undefined
    ): Promise<KernelConnectionMetadata | undefined> {
        let kernelConnection: KernelConnectionMetadata | undefined;
        const isLocalConnection = connection?.localLaunch ?? isLocalLaunch(this.configService);

        if (isLocalConnection) {
            kernelConnection = await this.selectLocalJupyterKernel(resource, connection, currentKernelDisplayName);
        } else if (connection && connection.type === 'jupyter') {
            kernelConnection = await this.selectRemoteJupyterKernel(resource, connection, currentKernelDisplayName);
        }
        return cloneDeep(kernelConnection);
    }

    private async selectLocalJupyterKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        currentKernelDisplayName: string | undefined
    ): Promise<KernelConnectionMetadata | undefined> {
        return this.selectLocalKernel(resource, new StopWatch(), connInfo, undefined, currentKernelDisplayName);
    }

    private async selectRemoteJupyterKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        currentKernelDisplayName?: string
    ): Promise<KernelConnectionMetadata | undefined> {
        const stopWatch = new StopWatch();
        return this.selectRemoteKernel(resource, stopWatch, connInfo, undefined, currentKernelDisplayName);
    }

    private async selectKernel<T extends KernelConnectionMetadata>(
        resource: Resource,
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
        if (selection.selection.interpreter) {
            this.interpreterPackages.trackPackages(selection.selection.interpreter);
        }
        sendKernelTelemetryEvent(resource, Telemetry.SwitchKernel);
        return (this.useSelectedKernel(selection.selection, cancelToken) as unknown) as T | undefined;
    }

    private async useSelectedKernel(
        selection: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        // Check if ipykernel is installed in this kernel.
        if (selection.kind === 'connectToLiveKernel') {
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
        } else if (selection.interpreter) {
            sendTelemetryEvent(Telemetry.SwitchToInterpreterAsKernel);
            // No kernelspec just create a dummy one
            const kernelSpec = createDefaultKernelSpec(selection.interpreter);
            return { kernelSpec, interpreter: selection.interpreter, kind: 'startUsingPythonInterpreter' };
        } else {
            return;
        }
    }
}
