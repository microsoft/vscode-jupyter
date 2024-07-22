// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands, Extension, QuickPickItem, window, extensions } from 'vscode';
import { JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';
import { injectable } from 'inversify';
import { IJupyterVariable } from '../../../kernels/variables/types';
import { IVariableViewer } from '../variablesView/types';
import { noop } from '../../../platform/common/utils/misc';
import { sendTelemetryEvent } from '../../../platform/telemetry';
import { logger } from '../../../platform/logging';
import * as localize from '../../../platform/common/utils/localize';

@injectable()
export class DataViewerDelegator {
    public async showContributedDataViewer(variable: IJupyterVariable) {
        try {
            // jupyterVariableViewers
            const variableViewers = this.getMatchingExternalVariableViewers(variable);
            if (variableViewers.length === 0) {
                // No data frame viewer extensions, show notifications
                return window
                    .showInformationMessage(
                        localize.DataScience.dataViewerExtensionRequired,
                        { modal: true },
                        localize.Common.bannerLabelYes
                    )
                    .then((answer) => {
                        if (answer === localize.Common.bannerLabelYes) {
                            commands
                                .executeCommand('workbench.extensions.search', '@tag:jupyterVariableViewers')
                                .then(noop, noop);
                        }
                    });
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
                quickPick.title = localize.DataScience.selectExternalDataViewer;
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
        } catch (e) {
            logger.error(e);
            sendTelemetryEvent(Telemetry.FailedShowDataViewer);
            window.showErrorMessage(localize.DataScience.showDataViewerFail).then(noop, noop);
        }
    }

    private getMatchingExternalVariableViewers(
        variable: IJupyterVariable
    ): { extension: Extension<unknown>; jupyterVariableViewers: IVariableViewer }[] {
        const variableViewers = this.getVariableViewers();
        return variableViewers
            .filter((d) => d.jupyterVariableViewers.dataTypes.includes(variable.type))
            .filter((e) => e.extension.id !== JVSC_EXTENSION_ID);
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
