import { inject, injectable } from 'inversify';
import { UIKind } from 'vscode';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../common/application/types';
import { Experiments } from '../common/experiments/groups';
import {
    IBrowserService,
    IExperimentService,
    IJupyterExtensionBanner,
    IPersistentState,
    IPersistentStateFactory
} from '../common/types';
import * as localize from '../common/utils/localize';
import { MillisecondsInADay } from '../constants';

export enum InsidersNotebookSurveyStateKeys {
    ShowBanner = 'ShowInsidersNotebookSurveyBanner',
    OpenNotebookCount = 'DS_InsidersNotebookOpenNotebookCount',
    ExecutionCount = 'DS_InsidersNotebookExecutionCount'
}

enum DSSurveyLabelIndex {
    Yes,
    No
}

const NotebookOpenThreshold = 5;
const NotebookExecutionThreshold = 100;
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
export class InsidersNativeNotebooksSurveyBanner implements IJupyterExtensionBanner {
    private get enabled(): boolean {
        if (this.applicationEnvironment.uiKind !== UIKind.Desktop) {
            return false;
        }
        if (!this.showBannerState.value.expiry) {
            return true;
        }
        return this.showBannerState.value.expiry! < Date.now();
    }

    private disabledInCurrentSession = false;

    private bannerMessage: string = localize.InsidersNativeNotebooksSurveyBanner.bannerMessage();

    private bannerLabels: string[] = [
        localize.DataScienceSurveyBanner.bannerLabelYes(),
        localize.DataScienceSurveyBanner.bannerLabelNo()
    ];

    private readonly showBannerState: IPersistentState<ShowBannerWithExpiryTime>;

    private readonly surveyLink: string;

    constructor(
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IPersistentStateFactory) private persistentState: IPersistentStateFactory,
        @inject(IBrowserService) private browserService: IBrowserService,
        @inject(IVSCodeNotebook) vscodeNotebook: IVSCodeNotebook,
        @inject(IExperimentService) private experimentService: IExperimentService,
        @inject(IApplicationEnvironment) private applicationEnvironment: IApplicationEnvironment,
        surveyLink = 'https://aka.ms/vscjupyternb'
    ) {
        this.surveyLink = surveyLink;
        this.showBannerState = this.persistentState.createGlobalPersistentState<ShowBannerWithExpiryTime>(
            InsidersNotebookSurveyStateKeys.ShowBanner,
            {
                data: true
            }
        );
        vscodeNotebook.onDidOpenNotebookDocument(this.openedNotebook.bind(this));
    }

    public async showBanner(): Promise<void> {
        const executionCount: number = this.getExecutionCount();
        const notebookCount: number = this.getOpenNotebookCount();
        const show = await this.shouldShowBanner(executionCount, notebookCount);
        if (!show) {
            return;
        }
        // Disable for the current session.
        this.disabledInCurrentSession = true;
        const response = await this.appShell.showInformationMessage(this.bannerMessage, ...this.bannerLabels);
        switch (response) {
            case this.bannerLabels[DSSurveyLabelIndex.Yes]: {
                await this.launchSurvey();
                // Disable for 6 months
                await this.disable(6);
                break;
            }
            case this.bannerLabels[DSSurveyLabelIndex.No]: {
                // Disable for 3 months
                await this.disable(3);
                break;
            }
            default: {
                //
            }
        }
    }

    public async shouldShowBanner(executionCount: number, notebookOpenCount: number): Promise<boolean> {
        if (!this.enabled || this.disabledInCurrentSession) {
            return false;
        }

        return (
            (await this.isInsidersNativeNotebooksUser()) &&
            (executionCount >= NotebookExecutionThreshold || notebookOpenCount > NotebookOpenThreshold)
        );
    }

    public async launchSurvey(): Promise<void> {
        this.browserService.launch(this.surveyLink);
    }

    private async isInsidersNativeNotebooksUser() {
        return (
            this.applicationEnvironment.channel === 'insiders' &&
            this.experimentService.inExperiment(Experiments.NativeNotebook)
        );
    }

    private getOpenNotebookCount(): number {
        const state = this.persistentState.createGlobalPersistentState<number>(
            InsidersNotebookSurveyStateKeys.OpenNotebookCount,
            0
        );
        return state.value;
    }

    private getExecutionCount(): number {
        const state = this.persistentState.createGlobalPersistentState<number>(
            InsidersNotebookSurveyStateKeys.ExecutionCount,
            0
        );
        return state.value;
    }

    private async disable(monthsTillNextPrompt: number) {
        await this.showBannerState.updateValue({
            expiry: monthsTillNextPrompt * 31 * MillisecondsInADay + Date.now(),
            data: true
        });
    }

    private async openedNotebook() {
        const state = this.persistentState.createGlobalPersistentState<number>(
            InsidersNotebookSurveyStateKeys.OpenNotebookCount,
            0
        );
        await state.updateValue(state.value + 1);
        return this.showBanner();
    }
}
