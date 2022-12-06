// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DataScience } from '../common/utils/localize';
import { ReportableAction } from './types';

const progressMessages = {
    [ReportableAction.JupyterSessionWaitForIdleSession]: DataScience.waitingForJupyterSessionToBeIdle(),
    [ReportableAction.KernelsGetKernelForRemoteConnection]: DataScience.gettingListOfKernelsForRemoteConnection(),
    [ReportableAction.KernelsGetKernelSpecs]: DataScience.gettingListOfKernelSpecs(),
    [ReportableAction.KernelsRegisterKernel]: DataScience.registeringKernel(),
    [ReportableAction.NotebookConnect]: DataScience.connectingToJupyter(),
    [ReportableAction.NotebookStart]: DataScience.startingJupyterNotebook(),
    [ReportableAction.InstallingMissingDependencies]: DataScience.installingMissingDependencies(),
    [ReportableAction.ExportNotebookToPython]: DataScience.exportNotebookToPython(),
    [ReportableAction.PerformingExport]: DataScience.performingExport()
};

/**
 * Given a reportable action, this will return the user friendly message.
 *
 * @export
 * @param {ReportableAction} action
 * @returns {(string | undefined)}
 */
export function getUserMessageForAction(action: ReportableAction): string | undefined {
    return progressMessages[action];
}
