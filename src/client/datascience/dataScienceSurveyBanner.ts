// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, UIKind } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../common/constants';
import { Experiments } from '../common/experiments/groups';
import '../common/extensions';
import { traceError } from '../common/logger';
import {
    IBrowserService,
    IDisposableRegistry,
    IExperimentService,
    IJupyterExtensionBanner,
    IPersistentState,
    IPersistentStateFactory,
    ISurveyBanner
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
        @inject(ISurveyBanner)
        private readonly dataScienceSurveyBanner: ISurveyBanner
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
                } // test change
                break;
            case BannerType.DSSurvey:
                if (this.applicationEnvironment.channel === 'stable') {
                    return this.isEnabledInternal(type);
                }
                break;
            default:
                traceError('Invalid Banner Type');
                return false;
        }
        return false;
    }
    private isEnabledInternal(type: BannerType): boolean {
        if (this.applicationEnvironment.uiKind !== UIKind.Desktop) {
            return false;
        }

        if (!this.showBannerState.get(type)!.value.expiry) {
            return true;
        }
        return this.showBannerState.get(type)!.value.expiry! < Date.now();
    }

    private disabledInCurrentSession: boolean = false;
    private bannerLabels: string[] = [
        localize.DataScienceSurveyBanner.bannerLabelYes(),
        localize.DataScienceSurveyBanner.bannerLabelNo()
    ];
    private readonly showBannerState = new Map<BannerType, IPersistentState<ShowBannerWithExpiryTime>>();

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
        this.setPersistentState(BannerType.DSSurvey, DSSurveyStateKeys.ShowBanner);
        this.setPersistentState(BannerType.InsidersNotebookSurvey, InsidersNotebookSurveyStateKeys.ShowBanner);
        this.setPersistentState(BannerType.ExperimentNotebookSurvey, ExperimentNotebookSurveyStateKeys.ShowBanner);
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

    private shouldShowBanner(type: BannerType) {
        if (!this.isEnabled(type) || this.disabledInCurrentSession) {
            return false;
        }

        const executionCount: number = this.getExecutionCount(type);
        const notebookCount: number = this.getOpenNotebookCount(type);

        return executionCount >= NotebookExecutionThreshold || notebookCount > NotebookOpenThreshold;
    }

    private setPersistentState(type: BannerType, val: string): void {
        this.showBannerState.set(
            type,
            this.persistentState.createGlobalPersistentState<ShowBannerWithExpiryTime>(val, {
                data: true
            })
        );
    }

    private async launchSurvey(type: BannerType): Promise<void> {
        this.browserService.launch(this.getSurveyLink(type));
    }
    private async disable(monthsTillNextPrompt: number, type: BannerType) {
        await this.showBannerState.get(type)!.updateValue({
            expiry: monthsTillNextPrompt * 31 * MillisecondsInADay + Date.now(),
            data: true
        });
    }

    private getOpenNotebookCount(type: BannerType): number {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                return this.getPersistentState(InsidersNotebookSurveyStateKeys.OpenNotebookCount);
            case BannerType.ExperimentNotebookSurvey:
                return this.getPersistentState(ExperimentNotebookSurveyStateKeys.OpenNotebookCount);
            case BannerType.DSSurvey:
                return this.getPersistentState(DSSurveyStateKeys.OpenNotebookCount);
            default:
                traceError('Invalid Banner type');
                return -1;
        }
    }

    private getExecutionCount(type: BannerType): number {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                return this.getPersistentState(InsidersNotebookSurveyStateKeys.ExecutionCount);
            case BannerType.ExperimentNotebookSurvey:
                return this.getPersistentState(ExperimentNotebookSurveyStateKeys.ExecutionCount);
            case BannerType.DSSurvey:
                return this.getPersistentState(DSSurveyStateKeys.ExecutionCount);
            default:
                traceError('Invalid Banner type');
                return -1;
        }
    }

    private getPersistentState(val: string): number {
        const state = this.persistentState.createGlobalPersistentState<number>(val, 0);
        return state.value;
    }

    private async openedNotebook() {
        void this.updateStateAndShowBanner(DSSurveyStateKeys.OpenNotebookCount, BannerType.DSSurvey);
        void this.updateStateAndShowBanner(
            InsidersNotebookSurveyStateKeys.OpenNotebookCount,
            BannerType.InsidersNotebookSurvey
        );
        void this.updateStateAndShowBanner(
            ExperimentNotebookSurveyStateKeys.OpenNotebookCount,
            BannerType.ExperimentNotebookSurvey
        );
    }

    private async kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        if (kernelStateEvent.state === KernelState.executed) {
            void this.updateStateAndShowBanner(
                InsidersNotebookSurveyStateKeys.ExecutionCount,
                BannerType.InsidersNotebookSurvey
            );
            void this.updateStateAndShowBanner(
                ExperimentNotebookSurveyStateKeys.ExecutionCount,
                BannerType.ExperimentNotebookSurvey
            );
        }
    }

    private async updateStateAndShowBanner(val: string, banner: BannerType) {
        const state = this.persistentState.createGlobalPersistentState<number>(val, 0);
        await state.updateValue(state.value + 1);
        void this.showBanner(banner);
    }

    private getBannerMessage(type: BannerType): string {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
            case BannerType.ExperimentNotebookSurvey:
                return localize.InsidersNativeNotebooksSurveyBanner.bannerMessage();
            case BannerType.DSSurvey:
                return localize.DataScienceSurveyBanner.bannerMessage();
            default:
                traceError('Invalid Banner type');
                return '';
        }
    }

    private getSurveyLink(type: BannerType): string {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                return 'https://aka.ms/vscjupyternb';
            case BannerType.ExperimentNotebookSurvey:
                return 'https://aka.ms/vscnbexp';
            case BannerType.DSSurvey:
                return 'https://aka.ms/pyaisurvey';
            default:
                traceError('Invalid Banner type');
                return '';
        }
    }
}
