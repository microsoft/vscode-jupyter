// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
// eslint-disable-next-line
import parseArgsStringToArgv from 'string-argv';
import { ConfigurationChangeEvent, ConfigurationTarget, QuickPickItem, Uri } from 'vscode';
import { IWorkspaceService, IApplicationShell, ICommandManager } from '../../../platform/common/application/types';
import { IConfigurationService } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import {
    IMultiStepInputFactory,
    IMultiStepInput,
    InputStep,
    IQuickPickParameters
} from '../../../platform/common/utils/multiStepInput';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';

/**
 * Provide a quick pick to let a user select command line options for starting jupyter
 */
@injectable()
export class JupyterCommandLineSelector {
    private readonly defaultLabel = `$(zap) ${DataScience.jupyterCommandLineDefaultLabel()}`;
    private readonly customLabel = `$(gear) ${DataScience.jupyterCommandLineCustomLabel()}`;
    constructor(
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this));
    }

    public async selectJupyterCommandLine(file: Uri): Promise<void> {
        const multiStep = this.multiStepFactory.create<{}>();
        await multiStep.run(this.startSelectingCommandLine.bind(this, file), {});
    }

    private async onDidChangeConfiguration(e: ConfigurationChangeEvent) {
        if (e.affectsConfiguration('jupyter.jupyterCommandLineArguments')) {
            const reload = DataScience.jupyterCommandLineReloadAnswer();
            const item = await this.appShell.showInformationMessage(
                DataScience.jupyterCommandLineReloadQuestion(),
                reload
            );
            if (item === reload) {
                this.commandManager.executeCommand('workbench.action.reloadWindow').then(noop, noop);
            }
        }
    }

    private async startSelectingCommandLine(
        file: Uri,
        input: IMultiStepInput<{}>,
        _state: {}
    ): Promise<InputStep<{}> | void> {
        // First step, show a quick pick to choose either the custom or the default.
        // newChoice element will be set if the user picked 'enter a new server'
        const item = await input.showQuickPick<QuickPickItem, IQuickPickParameters<QuickPickItem>>({
            placeholder: DataScience.jupyterCommandLineQuickPickPlaceholder(),
            items: this.getPickList(),
            title: DataScience.jupyterCommandLineQuickPickTitle()
        });
        if (item.label === this.defaultLabel) {
            await this.setJupyterCommandLine('');
        } else {
            return this.selectCustomCommandLine.bind(this, file);
        }
    }
    private async selectCustomCommandLine(
        file: Uri,
        input: IMultiStepInput<{}>,
        _state: {}
    ): Promise<InputStep<{}> | void> {
        // Ask the user to enter a command line
        const result = await input.showInputBox({
            title: DataScience.jupyterCommandLinePrompt(),
            value: this.configuration.getSettings(file).jupyterCommandLineArguments.join(' '),
            validate: this.validate,
            prompt: ''
        });

        if (result) {
            await this.setJupyterCommandLine(result);
        }
    }

    private async setJupyterCommandLine(val: string): Promise<void> {
        if (val) {
            sendTelemetryEvent(Telemetry.JupyterCommandLineNonDefault);
        }
        const split = parseArgsStringToArgv(val);
        await this.configuration.updateSetting(
            'jupyterCommandLineArguments',
            split,
            undefined,
            ConfigurationTarget.Workspace
        );
    }

    private validate = async (_inputText: string): Promise<string | undefined> => {
        return undefined;
    };

    private getPickList(): QuickPickItem[] {
        // Always have 'local' and 'custom'
        const items: QuickPickItem[] = [];
        items.push({ label: this.defaultLabel, detail: DataScience.jupyterCommandLineDefaultDetail() });
        items.push({ label: this.customLabel, detail: DataScience.jupyterCommandLineCustomDetail() });

        return items;
    }
}
