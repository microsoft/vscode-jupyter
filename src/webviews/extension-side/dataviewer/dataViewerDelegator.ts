// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands, Extension, QuickPickItem, window, extensions } from 'vscode';
import { Experiments, IExperimentService } from '../../../platform/common/types';
import { Commands, JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';
import { inject, injectable } from 'inversify';
import { IJupyterVariable } from '../../../kernels/variables/types';
import { IVariableViewer } from '../variablesView/types';
import { noop } from '../../../platform/common/utils/misc';
import { sendTelemetryEvent } from '../../../platform/telemetry';
import { logger } from '../../../platform/logging';
import * as localize from '../../../platform/common/utils/localize';

@injectable()
export class DataViewerDelegator {
    constructor(@inject(IExperimentService) private readonly experiments: IExperimentService) {}

    public async showContributedDataViewer(variable: IJupyterVariable) {
        try {
            if (this.experiments.inExperiment(Experiments.DataViewerContribution)) {
                // jupyterVariableViewers
                const variableViewers = this.getMatchingVariableViewers(variable);
                if (variableViewers.length === 0) {
                    // No data frame viewer extensions, show notifications
                    return commands.executeCommand('workbench.extensions.search', '@tag:jupyterVariableViewers');
                } else if (variableViewers.length === 1) {
                    const command = variableViewers[0].jupyterVariableViewers.command;
                    return commands.executeCommand(command, variable);
                } else {
                    const thirdPartyViewers = variableViewers.filter((d) => d.extension.id !== JVSC_EXTENSION_ID);
                    if (thirdPartyViewers.length === 1) {
                        const command = thirdPartyViewers[0].jupyterVariableViewers.command;
                        return commands.executeCommand(command, variable);
                    }
                    // show quick pick
                    const quickPick = window.createQuickPick<QuickPickItem & { command: string }>();
                    quickPick.title = 'Select DataFrame Viewer';
                    quickPick.items = variableViewers.map((d) => {
                        return {
                            label: d.jupyterVariableViewers.title,
                            detail: d.extension.packageJSON?.displayName ?? d.extension.id,
                            command: d.jupyterVariableViewers.command
                        };
                    });
                    quickPick.onDidAccept(async () => {
                        const item = quickPick.selectedItems[0];
                        if (item) {
                            quickPick.hide();
                            return commands.executeCommand(item.command, variable);
                        }
                    });
                    quickPick.show();
                }
            } else {
                return commands.executeCommand(Commands.ShowJupyterDataViewer, variable);
            }
        } catch (e) {
            logger.error(e);
            sendTelemetryEvent(Telemetry.FailedShowDataViewer);
            window.showErrorMessage(localize.DataScience.showDataViewerFail).then(noop, noop);
        }
    }

    private getMatchingVariableViewers(
        variable: IJupyterVariable
    ): { extension: Extension<unknown>; jupyterVariableViewers: IVariableViewer }[] {
        const variableViewers = this.getVariableViewers();
        return variableViewers.filter((d) => d.jupyterVariableViewers.dataTypes.includes(variable.type));
    }

    public getVariableViewers(): { extension: Extension<unknown>; jupyterVariableViewers: IVariableViewer }[] {
        const variableViewers = extensions.all
            .filter(
                (e) =>
                    e.packageJSON?.contributes?.jupyterVariableViewers &&
                    e.packageJSON?.contributes?.jupyterVariableViewers.length
            )
            .map((e) => {
                const contributes = e.packageJSON?.contributes;
                if (contributes?.jupyterVariableViewers) {
                    return contributes.jupyterVariableViewers.map((jupyterVariableViewers: IVariableViewer) => ({
                        extension: e,
                        jupyterVariableViewers
                    }));
                }
                return [];
            })
            .flat();

        return variableViewers;
    }
}
