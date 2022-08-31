// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { getExperimentationService, IExperimentationService, TargetPopulation } from 'vscode-tas-client';
import { IApplicationEnvironment } from '../application/types';
import { JVSC_EXTENSION_ID, STANDARD_OUTPUT_CHANNEL } from '../constants';
import { traceVerbose } from '../../logging';
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
import { ExperimentationTelemetry } from './telemetry.node';

// This is a hacky way to determine what experiments have been loaded by the Experiments service.
// There's no public API yet, hence we access the global storage that is updated by the experiments package.
const EXP_MEMENTO_KEY = 'VSCode.ABExp.FeatureData';

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
    private logged?: boolean;

    private get enabled() {
        return this.settings.experiments.enabled;
    }
    constructor(
        @inject(IConfigurationService) readonly configurationService: IConfigurationService,
        @inject(IApplicationEnvironment) private readonly appEnvironment: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel
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

        if (this.appEnvironment.channel === 'insiders') {
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

        traceVerbose(`Experimentation service retrieved: ${this.experimentationService}`);

        this.logExperiments();
    }

    public async activate() {
        if (this.experimentationService) {
            await this.experimentationService.initializePromise;
        }
    }
    public async inExperiment(experiment: ExperimentGroups): Promise<boolean> {
        if (!this.experimentationService) {
            return false;
        }

        // Currently the service doesn't support opting in and out of experiments,
        // so we need to perform these checks and send the corresponding telemetry manually.
        switch (this.getOptInOptOutStatus(experiment)) {
            case 'optOut': {
                return false;
            }
            case 'optIn': {
                await this.experimentationService.isCachedFlightEnabled(experiment);
                return true;
            }

            default:
                return this.experimentationService.isCachedFlightEnabled(experiment);
        }
    }

    public async getExperimentValue<T extends boolean | number | string>(experiment: string): Promise<T | undefined> {
        if (!this.experimentationService || this._optOutFrom.includes(experiment)) {
            return;
        }

        return this.experimentationService.getTreatmentVariableAsync('vscode', experiment);
    }
    public logExperiments() {
        if (!this.experimentationService || this.logged) {
            return;
        }
        this.logged = true;
        const experiments = this.globalState.get<{ features: string[] }>(EXP_MEMENTO_KEY, { features: [] });
        experiments.features.forEach((exp) => {
            // Filter out experiments groups that are not from the Python extension.
            if (exp.toLowerCase().startsWith('jupyter')) {
                this.output.appendLine(Experiments.inGroup().format(exp));
            }
        });
        this.getExperimentsUserHasManuallyOptedInto().forEach((exp) => {
            this.output.appendLine(Experiments.inGroup().format(exp));
        });
    }
    private getOptInOptOutStatus(experiment: ExperimentGroups): 'optOut' | 'optIn' | undefined {
        if (!this.experimentationService) {
            return;
        }

        // Currently the service doesn't support opting in and out of experiments,
        // so we need to perform these checks and send the corresponding telemetry manually.
        if (this._optOutFrom.includes(experiment)) {
            return 'optOut';
        }

        if (this._optInto.includes(experiment)) {
            return 'optIn';
        }
    }
    private getExperimentsUserHasManuallyOptedInto(): ExperimentGroups[] {
        return Object.values(ExperimentGroups).filter(
            (experiment) => this.getOptInOptOutStatus(experiment) === 'optIn'
        );
    }
}
