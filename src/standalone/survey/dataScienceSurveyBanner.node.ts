// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { UIKind } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IApplicationEnvironment } from '../../platform/common/application/types';
import { traceError } from '../../platform/logging';
import {
    BannerType,
    IJupyterExtensionBanner,
    IPersistentState,
    IPersistentStateFactory,
    IsCodeSpace
} from '../../platform/common/types';

export const ISurveyBanner = Symbol('ISurveyBanner');
export interface ISurveyBanner extends IExtensionSyncActivationService, IJupyterExtensionBanner {}

export enum InsidersNotebookSurveyStateKeys {
    ShowBanner = 'ShowInsidersNotebookSurveyBanner',
    ExecutionCount = 'DS_InsidersNotebookExecutionCount'
}

export enum ExperimentNotebookSurveyStateKeys {
    ShowBanner = 'ShowExperimentNotebookSurveyBanner',
    ExecutionCount = 'DS_ExperimentNotebookExecutionCount'
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

/**
 * Puts up a survey banner after a certain number of notebook executions. The survey will only show after 10 minutes have passed to prevent it from showing up immediately.
 */
@injectable()
export class DataScienceSurveyBanner implements IJupyterExtensionBanner, IExtensionSyncActivationService {
    public isEnabled(type: BannerType): boolean {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                if (this.applicationEnvironment.channel === 'insiders') {
                    return this.isEnabledInternal(type);
                }
                break;
            case BannerType.ExperimentNotebookSurvey:
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
    private readonly showBannerState = new Map<BannerType, IPersistentState<ShowBannerWithExpiryTime>>();
    private static surveyDelay = false;
    private readonly NotebookExecutionThreshold = 250; // Cell executions before showing survey

    constructor(
        @inject(IPersistentStateFactory) private persistentState: IPersistentStateFactory,
        @inject(IApplicationEnvironment) private applicationEnvironment: IApplicationEnvironment,
        @inject(IsCodeSpace) private readonly isCodeSpace: boolean
    ) {
        this.setPersistentState(BannerType.InsidersNotebookSurvey, InsidersNotebookSurveyStateKeys.ShowBanner);
        this.setPersistentState(BannerType.ExperimentNotebookSurvey, ExperimentNotebookSurveyStateKeys.ShowBanner);

        // Change the surveyDelay flag after 10 minutes
        setTimeout(() => {
            DataScienceSurveyBanner.surveyDelay = true;
        }, 10 * 60 * 1000);
    }

    public activate() {}

    public async showBanner(type: BannerType): Promise<void> {
        const show = this.shouldShowBanner(type);
        if (!show) {
            return;
        }
        // Disable for the current session.
        this.disabledInCurrentSession = true;
    }

    private shouldShowBanner(type: BannerType) {
        if (
            this.isCodeSpace ||
            !this.isEnabled(type) ||
            this.disabledInCurrentSession ||
            !DataScienceSurveyBanner.surveyDelay
        ) {
            return false;
        }

        const executionCount: number = this.getExecutionCount(type);

        return executionCount >= this.NotebookExecutionThreshold;
    }

    private setPersistentState(type: BannerType, val: string): void {
        this.showBannerState.set(
            type,
            this.persistentState.createGlobalPersistentState<ShowBannerWithExpiryTime>(val, {
                data: true
            })
        );
    }

    private getExecutionCount(type: BannerType): number {
        switch (type) {
            case BannerType.InsidersNotebookSurvey:
                return this.getPersistentState(InsidersNotebookSurveyStateKeys.ExecutionCount);
            case BannerType.ExperimentNotebookSurvey:
                return this.getPersistentState(ExperimentNotebookSurveyStateKeys.ExecutionCount);
            default:
                traceError('Invalid Banner type');
                return -1;
        }
    }

    private getPersistentState(val: string): number {
        const state = this.persistentState.createGlobalPersistentState<number>(val, 0);
        return state.value;
    }
}
