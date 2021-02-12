// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Event, EventEmitter, UIKind } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../common/constants';
import { Experiments } from '../common/experiments/groups';
import '../common/extensions';
import {
    BANNER_NAME_DS_SURVEY,
    IBrowserService,
    IDisposableRegistry,
    IExperimentService,
    IJupyterExtensionBanner,
    IPersistentState,
    IPersistentStateFactory
} from '../common/types';
import * as localize from '../common/utils/localize';
import { noop } from '../common/utils/misc';
import { MillisecondsInADay } from '../constants';
import { InteractiveWindowMessages, IReExecuteCells } from './interactive-common/interactiveWindowTypes';
import { KernelState, KernelStateEventArgs } from './notebookExtensibility';
import { IInteractiveWindowListener, INotebookEditorProvider, INotebookExtensibility } from './types';

export enum DSSurveyStateKeys {
    ShowBanner = 'ShowDSSurveyBanner',
    OpenNotebookCount = 'DS_OpenNotebookCount',
    ExecutionCount = 'DS_ExecutionCount'
}

export enum InsidersNotebookSurveyStateKeys {
    ShowBanner = 'ShowInsidersNotebookSurveyBanner',
    OpenNotebookCount = 'DS_InsidersNotebookOpenNotebookCount',
    ExecutionCount = 'DS_InsidersNotebookExecutionCount'
}

export enum ExperimentNotebookSurveyStateKeys {
    ShowBanner = 'ShowExperimentNotebookSurveyBanner',
    OpenNotebookCount = 'DS_ExperimentNotebookOpenNotebookCount',
    ExecutionCount = 'DS_ExperimentNotebookExecutionCount'
}

export enum BannerType {
    DSSurvey,
    InsidersNotebookSurvey,
    ExperimentNotebookSurvey
}

enum DSSurveyLabelIndex {
    Yes,
    No
}

const NotebookOpenThreshold = 5;
const NotebookExecutionThreshold = 100;

@injectable()
export class DataScienceSurveyBannerLogger implements IInteractiveWindowListener {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private postEmitter = new EventEmitter<{ message: string; payload: any }>();
    constructor(
        @inject(IPersistentStateFactory) private persistentState: IPersistentStateFactory,
        @inject(IJupyterExtensionBanner)
        @named(BANNER_NAME_DS_SURVEY)
        private readonly dataScienceSurveyBanner: IJupyterExtensionBanner
    ) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public onMessage(message: string, payload?: any): void {
        if (message === InteractiveWindowMessages.ReExecuteCells) {
            const args = payload as IReExecuteCells;
            if (args && args.cellIds.length) {
                const state = this.persistentState.createGlobalPersistentState<number>(
                    DSSurveyStateKeys.ExecutionCount,
                    0
                );
                state
                    .updateValue(state.value + args.cellIds.length)
                    .then(() => {
                        // On every update try to show the banner.
                        return this.dataScienceSurveyBanner.showBanner(BannerType.DSSurvey);
                    })
                    .ignoreErrors();
            }
        }
    }
    public dispose(): void | undefined {
        noop();
    }
}

export type ShowBannerWithExpiryTime = {
    /**
     * This value is not used.
     * We are only interested in the value for `expiry`.
     * This structure is based on the old data for older customers when we used PersistentState class.
     */
    data: boolean;
    /**
     * If this is value `undefined`, then prompt can be displayed.
     * If this value is `a number`, then a prompt was displayed at one point in time &
     * we need to wait for Date.now() to be greater than that number to display it again.
     */
    expiry?: number;
};
@injectable()
export class DataScienceSurveyBanner implements IJupyterExtensionBanner, IExtensionSingleActivationService {
    public isEnabled(type: BannerType): boolean {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                if (this.useVSCodeNotebookEditorApi && this.applicationEnvironment.channel === 'insiders') {
                    return this.isEnabledInternal(type);
                }
                break;
            case BannerType.ExperimentNotebookSurvey:
                if (
                    this.applicationEnvironment.channel === 'stable' &&
                    this.experimentService.inExperiment(Experiments.NativeNotebook)
                ) {
                    return this.isEnabledInternal(type);
                }
                break;
            case BannerType.DSSurvey:
            default:
                if (this.applicationEnvironment.channel === 'stable') {
                    return this.isEnabledInternal(type);
                }
        }
        return false;
    }
    private isEnabledInternal(type: BannerType): boolean {
        if (this.applicationEnvironment.uiKind !== UIKind.Desktop) {
            return false;
        }

        if (!this.showBannerState[type].value.expiry) {
            return true;
        }
        return this.showBannerState[type].value.expiry! < Date.now();
    }

    private disabledInCurrentSession: boolean = false;
    private bannerLabels: string[] = [
        localize.DataScienceSurveyBanner.bannerLabelYes(),
        localize.DataScienceSurveyBanner.bannerLabelNo()
    ];
    private readonly showBannerState: IPersistentState<ShowBannerWithExpiryTime>[] = [];

    constructor(
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IPersistentStateFactory) private persistentState: IPersistentStateFactory,
        @inject(IBrowserService) private browserService: IBrowserService,
        @inject(INotebookEditorProvider) editorProvider: INotebookEditorProvider,
        @inject(IApplicationEnvironment) private applicationEnvironment: IApplicationEnvironment,
        @inject(IVSCodeNotebook) private vscodeNotebook: IVSCodeNotebook,
        @inject(INotebookExtensibility) private notebookExtensibility: INotebookExtensibility,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(UseVSCodeNotebookEditorApi) private useVSCodeNotebookEditorApi: boolean,
        @inject(IExperimentService) private experimentService: IExperimentService
    ) {
        this.showBannerState[BannerType.DSSurvey] = this.persistentState.createGlobalPersistentState<
            ShowBannerWithExpiryTime
        >(DSSurveyStateKeys.ShowBanner, {
            data: true
        });
        this.showBannerState[BannerType.InsidersNotebookSurvey] = this.persistentState.createGlobalPersistentState<
            ShowBannerWithExpiryTime
        >(InsidersNotebookSurveyStateKeys.ShowBanner, {
            data: true
        });
        this.showBannerState[BannerType.ExperimentNotebookSurvey] = this.persistentState.createGlobalPersistentState<
            ShowBannerWithExpiryTime
        >(ExperimentNotebookSurveyStateKeys.ShowBanner, {
            data: true
        });
        editorProvider.onDidOpenNotebookEditor(this.openedNotebook.bind(this));
    }

    public async activate() {
        this.vscodeNotebook.onDidOpenNotebookDocument(this.openedNotebook, this, this.disposables);
        this.notebookExtensibility.onKernelStateChange(this.kernelStateChanged, this, this.disposables);
    }

    public async showBanner(type: BannerType): Promise<void> {
        const show = this.shouldShowBanner(type);
        if (!show) {
            return;
        }
        // Disable for the current session.
        this.disabledInCurrentSession = true;

        const response = await this.appShell.showInformationMessage(this.getBannerMessage(type), ...this.bannerLabels);
        switch (response) {
            case this.bannerLabels[DSSurveyLabelIndex.Yes]: {
                await this.launchSurvey(type);
                // Disable for 6 months
                await this.disable(6, type);
                break;
            }
            case this.bannerLabels[DSSurveyLabelIndex.No]: {
                // Disable for 3 months
                await this.disable(3, type);
                break;
            }
            default:
        }
    }

    public shouldShowBanner(type: BannerType) {
        if (!this.isEnabled(type) || this.disabledInCurrentSession) {
            return false;
        }

        const executionCount: number = this.getExecutionCount(type);
        const notebookCount: number = this.getOpenNotebookCount(type);

        return executionCount >= NotebookExecutionThreshold || notebookCount > NotebookOpenThreshold;
    }

    public async launchSurvey(type: BannerType): Promise<void> {
        this.browserService.launch(this.getSurveyLink(type));
    }
    private async disable(monthsTillNextPrompt: number, type: BannerType) {
        await this.showBannerState[type].updateValue({
            expiry: monthsTillNextPrompt * 31 * MillisecondsInADay + Date.now(),
            data: true
        });
    }

    private getOpenNotebookCount(type: BannerType): number {
        let state: IPersistentState<number>;
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                state = this.persistentState.createGlobalPersistentState<number>(
                    InsidersNotebookSurveyStateKeys.OpenNotebookCount,
                    0
                );
                return state.value;
            case BannerType.ExperimentNotebookSurvey:
                state = this.persistentState.createGlobalPersistentState<number>(
                    ExperimentNotebookSurveyStateKeys.OpenNotebookCount,
                    0
                );
                return state.value;
            case BannerType.DSSurvey:
            default:
                state = this.persistentState.createGlobalPersistentState<number>(
                    DSSurveyStateKeys.OpenNotebookCount,
                    0
                );
                return state.value;
        }
    }

    private getExecutionCount(type: BannerType): number {
        let state: IPersistentState<number>;
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                state = this.persistentState.createGlobalPersistentState<number>(
                    InsidersNotebookSurveyStateKeys.ExecutionCount,
                    0
                );
                return state.value;
            case BannerType.ExperimentNotebookSurvey:
                state = this.persistentState.createGlobalPersistentState<number>(
                    ExperimentNotebookSurveyStateKeys.ExecutionCount,
                    0
                );
                return state.value;
            case BannerType.DSSurvey:
            default:
                state = this.persistentState.createGlobalPersistentState<number>(DSSurveyStateKeys.ExecutionCount, 0);
                return state.value;
        }
    }

    private async openedNotebook() {
        const state1 = this.persistentState.createGlobalPersistentState<number>(DSSurveyStateKeys.OpenNotebookCount, 0);
        await state1.updateValue(state1.value + 1);
        this.showBanner(BannerType.DSSurvey);

        const state2 = this.persistentState.createGlobalPersistentState<number>(
            InsidersNotebookSurveyStateKeys.OpenNotebookCount,
            0
        );
        await state2.updateValue(state2.value + 1);
        this.showBanner(BannerType.InsidersNotebookSurvey);

        const state3 = this.persistentState.createGlobalPersistentState<number>(
            ExperimentNotebookSurveyStateKeys.OpenNotebookCount,
            0
        );
        await state3.updateValue(state3.value + 1);
        this.showBanner(BannerType.ExperimentNotebookSurvey);
    }

    private async kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        // TODO Only on insiders native notebook survey FOR NOW
        if (kernelStateEvent.state === KernelState.executed) {
            const state1 = this.persistentState.createGlobalPersistentState<number>(
                InsidersNotebookSurveyStateKeys.ExecutionCount,
                0
            );
            await state1.updateValue(state1.value + 1);
            this.showBanner(BannerType.InsidersNotebookSurvey);

            const state2 = this.persistentState.createGlobalPersistentState<number>(
                ExperimentNotebookSurveyStateKeys.ExecutionCount,
                0
            );
            await state2.updateValue(state2.value + 1);
            this.showBanner(BannerType.ExperimentNotebookSurvey);
        }
    }

    private getBannerMessage(type: BannerType): string {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
            case BannerType.ExperimentNotebookSurvey:
                return localize.InsidersNativeNotebooksSurveyBanner.bannerMessage();
            case BannerType.DSSurvey:
            default:
                return localize.DataScienceSurveyBanner.bannerMessage();
        }
    }

    private getSurveyLink(type: BannerType): string {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                return 'https://aka.ms/vscjupyternb';
            case BannerType.ExperimentNotebookSurvey:
                return 'https://aka.ms/vscnbexp';
            case BannerType.DSSurvey:
            default:
                return 'https://aka.ms/pyaisurvey';
        }
    }
}
