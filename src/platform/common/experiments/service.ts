// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento, workspace } from 'vscode';
import { getExperimentationService, IExperimentationService, TargetPopulation } from 'vscode-tas-client';
import { IApplicationEnvironment } from '../application/types';
import { JVSC_EXTENSION_ID, isPreReleaseVersion } from '../constants';
import { traceInfo, traceVerbose } from '../../logging';
import { GLOBAL_MEMENTO, IConfigurationService, IExperimentService, IJupyterSettings, IMemento } from '../types';
import { Experiments } from '../utils/localize';
import { Experiments as ExperimentGroups } from '../types';
import { ExperimentationTelemetry } from './telemetry.node';
import { getVSCodeChannel } from '../application/applicationEnvironment';

// This is a hacky way to determine what experiments have been loaded by the Experiments service.
// There's no public API yet, hence we access the global storage that is updated by the experiments package.
const EXP_MEMENTO_KEY = 'VSCode.ABExp.FeatureData';
const EXP_CONFIG_ID = 'vscode';

/**
 * Exposes an api to determine what experiments are in use. Experiments are generally feature flags that can be used to try out different features for a subset of users.
 * For more information, see https://expdocs.azurewebsites.net/docs/experimentauth/featureexperiments.html
 */
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

    private get enabled() {
        return this.settings.experiments.enabled && !this.settings.experiments.optOutFrom.includes('All');
    }
    constructor(
        @inject(IConfigurationService) readonly configurationService: IConfigurationService,
        @inject(IApplicationEnvironment) private readonly appEnvironment: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento
    ) {
        this.settings = configurationService.getSettings(undefined);

        // Users can only opt in or out of experiment groups, not control groups.
        const optInto = this.settings.experiments.optInto;
        const optOutFrom = this.settings.experiments.optOutFrom;
        this._optInto = optInto.filter((exp) => !exp.endsWith('control'));
        this._optOutFrom = optOutFrom.filter((exp) => !exp.endsWith('control'));

        // Don't initialize the experiment service if the extension's experiments setting is disabled.
        if (!this.enabled) {
            return;
        }

        let targetPopulation: TargetPopulation;

        if (getVSCodeChannel() === 'insiders') {
            targetPopulation = TargetPopulation.Insiders;
        } else {
            targetPopulation = TargetPopulation.Public;
        }

        const telemetryReporter = new ExperimentationTelemetry();

        this.experimentationService = getExperimentationService(
            JVSC_EXTENSION_ID,
            this.appEnvironment.extensionVersion!,
            targetPopulation,
            telemetryReporter,
            this.globalState
        );
    }

    public async activate() {
        if (this.experimentationService && this.enabled) {
            traceVerbose(`Experimentation service retrieved: ${this.experimentationService}`);
            await this.experimentationService.initializePromise;
            if (this.getFeatures().length === 0) {
                // Only await on this if we don't have anything in cache.
                // This means that we start the session with partial experiment info.
                // We accept this as a compromise to avoid delaying startup.

                // In the case where we don't wait on this promise. If the experiment info changes,
                // those changes will be applied in the next session. This is controlled internally
                // in the tas-client via `overrideInMemoryFeatures` value that is passed to
                // `getFeaturesAsync`. At the time of writing this comment the value of
                // `overrideInMemoryFeatures` was always passed in as `false`. So, the experiment
                // states did not change mid way.
                await this.experimentationService.initialFetch;
            }

            this.logExperiments();
        }
    }
    public inExperiment(experiment: ExperimentGroups): boolean {
        if (!this.experimentationService || !this.enabled) {
            return false;
        }
        // Currently the service doesn't support opting in and out of experiments,
        // so we need to perform these checks and send the corresponding telemetry manually.
        if (this._optOutFrom.includes(experiment.toString())) {
            return false;
        }

        if (this._optInto.includes(experiment.toString()) || this._optInto.includes('All')) {
            // Check if the user was already in the experiment server-side. We need to do
            // this to ensure the experiment service is ready and internal states are fully
            // synced with the experiment server.
            this.experimentationService.getTreatmentVariable(EXP_CONFIG_ID, experiment as unknown as string);
            return true;
        }

        // Enable the kernel completions experiment for all insider users
        if (
            experiment === ExperimentGroups.KernelCompletions &&
            (getVSCodeChannel() === 'insiders' || isPreReleaseVersion())
        ) {
            return true;
        }

        // If getTreatmentVariable returns undefined,
        // it means that the value for this experiment was not found on the server.
        const treatmentVariable = this.experimentationService.getTreatmentVariable(
            EXP_CONFIG_ID,
            experiment as unknown as string
        );
        return treatmentVariable === true;
    }

    public async getExperimentValue<T extends boolean | number | string>(
        experiment: ExperimentGroups
    ): Promise<T | undefined> {
        if (
            !this.experimentationService ||
            !this.enabled ||
            this._optOutFrom.includes(experiment as unknown as string)
        ) {
            return;
        }

        return this.experimentationService.getTreatmentVariable<T>(EXP_CONFIG_ID, experiment as unknown as string);
    }
    private getFeatures() {
        return this.globalState.get<{ features: string[] }>(EXP_MEMENTO_KEY, { features: [] }).features;
    }
    private logExperiments() {
        const telemetrySettings = workspace.getConfiguration('telemetry');
        let experimentsDisabled = false;
        if (telemetrySettings && telemetrySettings.get<boolean>('enableTelemetry') === false) {
            traceInfo('Telemetry is disabled');
            experimentsDisabled = true;
        }

        if (telemetrySettings && telemetrySettings.get<string>('telemetryLevel') === 'off') {
            traceInfo('Telemetry level is off');
            experimentsDisabled = true;
        }

        if (experimentsDisabled) {
            traceInfo('Experiments are disabled, only manually opted experiments are active.');
        }

        if (this._optOutFrom.includes('All')) {
            // We prioritize opt out first
            // Since we are in the Opt Out all case, this means when checking for experiment we
            // short circuit and return. So, printing out additional experiment info might cause
            // confusion. So skip printing out any specific experiment details to the log.
            return;
        }
        if (this._optInto.includes('All')) {
            // Only if 'All' is not in optOut then check if it is in Opt In.
            traceInfo(Experiments.inGroup('All'));

            // Similar to the opt out case. If user is opting into to all experiments we short
            // circuit the experiment checks. So, skip printing any additional details to the logs.
            return;
        }

        const optedIntoExperiments = new Set(this._optInto);
        const enabledExperiments = new Set<string>();

        // Log experiments that users manually opt out, these are experiments which are added using the exp framework.
        this._optOutFrom
            .filter((exp) => exp !== 'All')
            .forEach((exp) => {
                traceInfo(Experiments.notInGroup(exp));
            });

        // Log experiments that users manually opt into, these are experiments which are added using the exp framework.
        this._optInto
            .filter((exp) => exp !== 'All')
            .forEach((exp) => {
                enabledExperiments.add(exp);
                traceInfo(Experiments.inGroup(exp));
            });

        if (
            experimentsDisabled &&
            !enabledExperiments.has(ExperimentGroups.KernelCompletions) &&
            (getVSCodeChannel() === 'insiders' || isPreReleaseVersion())
        ) {
            traceInfo(Experiments.inGroup(ExperimentGroups.KernelCompletions));
        }

        if (!experimentsDisabled) {
            // Log experiments that users are added to by the exp framework
            this.getFeatures().forEach((exp) => {
                // Filter out experiment groups that are not from the Python extension.
                // Filter out experiment groups that are not already opted out or opted into.
                if (
                    exp.toLowerCase().startsWith('jupyter') &&
                    !this._optOutFrom.includes(exp) &&
                    !this._optInto.includes(exp)
                ) {
                    optedIntoExperiments.add(exp);
                    traceInfo(Experiments.inGroup(exp));
                }
            });
        }
    }
}
