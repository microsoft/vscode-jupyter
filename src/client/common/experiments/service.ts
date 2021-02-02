// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { getExperimentationService, IExperimentationService, TargetPopulation } from 'vscode-tas-client';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { IApplicationEnvironment } from '../application/types';
import { JVSC_EXTENSION_ID, STANDARD_OUTPUT_CHANNEL } from '../constants';
import { ExtensionUsage } from '../extensionUsage';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IExperimentService,
    IJupyterSettings,
    IMemento,
    IOutputChannel
} from '../types';
import { Experiments } from '../utils/localize';
import { Experiments as ExperimentGroups } from './groups';
import { ExperimentationTelemetry } from './telemetry';

// This is a hacky way to determine what experiments have been loaded by the Experiments service.
// There's no public API yet, hence we access the global storage that is updated by the experiments package.
const EXP_MEMENTO_KEY = 'VSCode.ABExp.FeatureData';

@injectable()
export class ExperimentService implements IExperimentService {
    /**
     * Experiments the user requested to opt into manually.
     */
    public _optInto: string[] = [];
    /**
     * Experiments the user requested to opt out from manually.
     */
    public _optOutFrom: string[] = [];

    private readonly experimentationService?: IExperimentationService;
    private readonly settings: IJupyterSettings;
    private logged?: boolean;

    constructor(
        @inject(IConfigurationService) readonly configurationService: IConfigurationService,
        @inject(IApplicationEnvironment) private readonly appEnvironment: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(ExtensionUsage) private readonly extensionUsage: ExtensionUsage,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel
    ) {
        this.settings = configurationService.getSettings(undefined);

        // Users can only opt in or out of experiment groups, not control groups.
        const optInto = this.settings.experiments.optInto;
        const optOutFrom = this.settings.experiments.optOutFrom;
        this._optInto = optInto.filter((exp) => !exp.endsWith('control'));
        this._optOutFrom = optOutFrom.filter((exp) => !exp.endsWith('control'));

        // Don't initialize the experiment service if the extension's experiments setting is disabled.
        const enabled = this.settings.experiments.enabled;
        if (!enabled) {
            return;
        }

        let targetPopulation: TargetPopulation;

        if (this.appEnvironment.extensionChannel === 'insiders') {
            targetPopulation = TargetPopulation.Insiders;
        } else {
            targetPopulation = TargetPopulation.Public;
        }

        const telemetryReporter = new ExperimentationTelemetry();

        this.experimentationService = getExperimentationService(
            JVSC_EXTENSION_ID,
            this.appEnvironment.packageJson.version!,
            targetPopulation,
            telemetryReporter,
            this.globalState
        );
    }
    public async inExperiment(experiment: ExperimentGroups): Promise<boolean> {
        if (!this.experimentationService) {
            return false;
        }

        // If user is already in Native Notebook experiment, then they cannot be in Custom Editor experiment.
        if (
            experiment === ExperimentGroups.CustomEditor &&
            this.getOptInOptOutStatus(ExperimentGroups.NativeNotebook) === 'optIn'
        ) {
            return false;
        }

        // Currently the service doesn't support opting in and out of experiments,
        // so we need to perform these checks and send the corresponding telemetry manually.
        switch (this.getOptInOptOutStatus(experiment)) {
            case 'optOut': {
                sendTelemetryEvent(EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT, undefined, {
                    expNameOptedOutOf: experiment
                });

                return false;
            }
            case 'optIn': {
                sendTelemetryEvent(EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT, undefined, {
                    expNameOptedInto: experiment
                });

                return true;
            }

            default:
                if (
                    experiment === ExperimentGroups.NativeNotebook &&
                    (await this.isNewUserInNativeNotebookExperiment())
                ) {
                    return true;
                }
                return this.experimentationService.isCachedFlightEnabled(experiment);
        }
    }

    public async getExperimentValue<T extends boolean | number | string>(experiment: string): Promise<T | undefined> {
        if (!this.experimentationService || this._optOutFrom.includes('All') || this._optOutFrom.includes(experiment)) {
            return;
        }

        return this.experimentationService.getTreatmentVariableAsync('vscode', experiment);
    }
    public async logExperiments() {
        if (!this.experimentationService || this.logged) {
            return;
        }
        this.logged = true;
        const isNewUserInNativeNotebookExperiment = await this.isNewUserInNativeNotebookExperiment();
        const experiments = this.globalState.get<{ features: string[] }>(EXP_MEMENTO_KEY, { features: [] });
        experiments.features.forEach((exp) => {
            // Filter out experiments groups that are not from the Python extension.
            if (exp.toLowerCase().startsWith('python') || exp.toLowerCase().startsWith('jupyter')) {
                this.output.appendLine(Experiments.inGroup().format(exp));
            }
            if (isNewUserInNativeNotebookExperiment) {
                this.output.appendLine(Experiments.inGroup().format(ExperimentGroups.NativeNotebook));
            }
        });
        this.getExperimentsUserHasManuallyOptedInto().forEach((exp) => {
            this.output.appendLine(Experiments.inGroup().format(exp));
        });
    }

    private async isNewUserInNativeNotebookExperiment() {
        // Only new users from stable can be in experiment.
        if (this.appEnvironment.channel === 'insiders') {
            return false;
        }
        if (!this.extensionUsage.isFirstTimeUser) {
            return false;
        }
        // If this user was already set to use native notebook, then keep using native notebooks.
        if (this.globalState.get('IS_IN_NATIVE_NOTEBOOK_NEW_USER_EXP', false)) {
            return true;
        }
        // This can be set to `false` if native notebook experiment is disabled for new users.
        if (!this.globalState.get('USER_CAN_BE_IN_NATIVE_NOTEBOOK_EXP', true)) {
            return false;
        }
        // So that even tomorrow they are treated as belonging to native notebooks.
        await this.globalState.update('IS_IN_NATIVE_NOTEBOOK_NEW_USER_EXP', true);
        // All new users will be in native notebook experiment, unless `USER_CAN_BE_IN_NATIVE_NOTEBOOK_EXP` is set to false.
        // This is set elsewhere based on some other criteria.
        return true;
    }
    private getOptInOptOutStatus(experiment: ExperimentGroups): 'optOut' | 'optIn' | undefined {
        if (!this.experimentationService) {
            return;
        }
        // Currently the service doesn't support opting in and out of experiments,
        // so we need to perform these checks and send the corresponding telemetry manually.
        if (this._optOutFrom.includes('All') || this._optOutFrom.includes(experiment)) {
            return 'optOut';
        }

        // In stable users cannot open into `NativeNotebook`.
        // (unless we have `__NativeNotebook__` in optIn) thats just a way for testing internally.
        if (this.appEnvironment.channel === 'stable' && experiment === ExperimentGroups.NativeNotebook) {
            return;
        }

        if (this._optInto.includes('All') || this._optInto.includes(experiment)) {
            return 'optIn';
        }

        // If using insiders VS Code, then always enable Native Editor.
        if (this.appEnvironment.channel === 'insiders' && experiment === ExperimentGroups.NativeNotebook) {
            return 'optIn';
        }
    }
    private getExperimentsUserHasManuallyOptedInto(): ExperimentGroups[] {
        return Object.values(ExperimentGroups).filter(
            (experiment) => this.getOptInOptOutStatus(experiment) === 'optIn'
        );
    }
}
