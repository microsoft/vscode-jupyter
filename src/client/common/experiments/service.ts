// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { getExperimentationService, IExperimentationService, TargetPopulation } from 'vscode-tas-client';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { IApplicationEnvironment, IWorkspaceService } from '../application/types';
import { JVSC_EXTENSION_ID, STANDARD_OUTPUT_CHANNEL } from '../constants';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IExperimentService,
    IExtensions,
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
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService
    ) {
        this.settings = configurationService.getSettings(undefined);

        // Users can only opt in or out of experiment groups, not control groups.
        const optInto = this.settings.experiments.optInto;
        const optOutFrom = this.settings.experiments.optOutFrom;
        this._optInto = optInto.filter((exp) => !exp.endsWith('control'));
        this._optOutFrom = optOutFrom.filter((exp) => !exp.endsWith('control'));

        // Custom settings just for native notebook support.
        const settings = workspaceService.getConfiguration('workbench', undefined);
        const editorAssociations = settings.get('editorAssociations') as {
            viewType: string;
            filenamePattern: string;
        }[];
        if (editorAssociations.find((a) => a.viewType && a.viewType.includes('jupyter-notebook'))) {
            this._optInto.push(`__${ExperimentGroups.NativeNotebook}__`);
        }

        // Don't initialize the experiment service if the extension's experiments setting is disabled.
        const enabled = this.settings.experiments.enabled;
        if (!enabled) {
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

        // If user has .NET interactive installed, we HAVE to be in the native experiment. See this issue:
        // https://github.com/microsoft/vscode-jupyter/issues/4771
        if (
            experiment === ExperimentGroups.NativeNotebook &&
            this.extensions.getExtension('ms-dotnettools.dotnet-interactive-vscode')
        ) {
            return true;
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
                await this.experimentationService.isCachedFlightEnabled(experiment);
                sendTelemetryEvent(EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT, undefined, {
                    expNameOptedInto: experiment
                });

                return true;
            }

            default:
                return this.experimentationService.isCachedFlightEnabled(experiment);
        }
    }

    public async getExperimentValue<T extends boolean | number | string>(experiment: string): Promise<T | undefined> {
        if (!this.experimentationService || this._optOutFrom.includes('All') || this._optOutFrom.includes(experiment)) {
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
            if (exp.toLowerCase().startsWith('python') || exp.toLowerCase().startsWith('jupyter')) {
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
        if (this._optOutFrom.includes('All') || this._optOutFrom.includes(experiment)) {
            return 'optOut';
        }

        // Users in stable cannot opt into notebook experiment unless we have `__NotebookEditor__` (used for testing).
        if (this.appEnvironment.channel === 'stable' && experiment === ExperimentGroups.NativeNotebook) {
            return this._optInto.includes(`__${experiment}__`) ? 'optIn' : undefined;
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
