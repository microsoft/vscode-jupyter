// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { CancellationToken } from 'vscode-jsonrpc';
import { IApplicationShell } from '../../../common/application/types';
import '../../../common/extensions';
import { IConfigurationService, Resource } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Commands, Telemetry } from '../../constants';
import { sendKernelListTelemetry } from '../../telemetry/kernelTelemetry';
import { sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import { INotebookProviderConnection } from '../../types';
import { getDisplayNameOrNameOfKernelConnection, isLocalLaunch } from './helpers';
import { KernelSelectionProvider } from './kernelSelections';
import { IKernelSpecQuickPickItem, KernelConnectionMetadata } from './types';
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
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(InterpreterPackages) private readonly interpreterPackages: InterpreterPackages
    ) {}

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
            const item = await this.selectJupyterKernel(resource, connection, undefined, displayName);
            return cloneDeep(item);
        }
    }
    public async selectJupyterKernel(
        resource: Resource,
        connection: INotebookProviderConnection | undefined,
        cancelToken: CancellationToken | undefined,
        currentKernelDisplayName: string | undefined
    ): Promise<KernelConnectionMetadata | undefined> {
        const isLocalConnection = connection?.localLaunch ?? isLocalLaunch(this.configService);
        const telemetryEvent = isLocalConnection ? Telemetry.SelectLocalJupyterKernel : Telemetry.SelectRemoteJupyterKernel;
        const stopWatch = new StopWatch();
        const suggestions = await this.selectionProvider.getKernelSelections(resource, connection, cancelToken);
        const selection = await this.selectKernel(
            resource,
            stopWatch,
            telemetryEvent,
            suggestions,
            cancelToken,
            currentKernelDisplayName
        );
        return cloneDeep(selection);
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
        return selection.selection;
    }
}
