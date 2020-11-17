import { inject, injectable } from 'inversify';
import { env, UIKind } from 'vscode';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../common/application/types';
import { Experiments } from '../common/experiments/groups';
import { IBrowserService, IExperimentService, IJupyterExtensionBanner, IPersistentStateFactory } from '../common/types';
import * as localize from '../common/utils/localize';

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

@injectable()
export class InsidersNativeNotebooksSurveyBanner implements IJupyterExtensionBanner {
    private get enabled(): boolean {
        return (
            this.persistentState.createGlobalPersistentState<boolean>(InsidersNotebookSurveyStateKeys.ShowBanner, true)
                .value && env.uiKind !== UIKind?.Web
        );
    }
    private disabledInCurrentSession: boolean = false;
    private bannerMessage: string = localize.InsidersNativeNotebooksSurveyBanner.bannerMessage();
    private bannerLabels: string[] = [
        localize.DataScienceSurveyBanner.bannerLabelYes(),
        localize.DataScienceSurveyBanner.bannerLabelNo()
    ];
    private readonly surveyLink: string;

    constructor(
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IPersistentStateFactory) private persistentState: IPersistentStateFactory,
        @inject(IBrowserService) private browserService: IBrowserService,
        @inject(IVSCodeNotebook) editorProvider: IVSCodeNotebook,
        @inject(IExperimentService) private experimentService: IExperimentService,
        @inject(IApplicationEnvironment) private applicationEnvironment: IApplicationEnvironment,
        surveyLink: string = 'https://aka.ms/vscjupyternb'
    ) {
        this.surveyLink = surveyLink;
        editorProvider.onDidOpenNotebookDocument(this.openedNotebook.bind(this));
    }

    public async showBanner(): Promise<void> {
        const executionCount: number = this.getExecutionCount();
        const notebookCount: number = this.getOpenNotebookCount();
        const show = await this.shouldShowBanner(executionCount, notebookCount);
        if (!show) {
            return;
        }

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
                // Disable for the current session.
                this.disabledInCurrentSession = true;
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
        const expiration = monthsTillNextPrompt * 31 * 24 * 60 * 60 * 1000;
        await this.persistentState
            .createGlobalPersistentState<boolean>(InsidersNotebookSurveyStateKeys.ShowBanner, false, expiration)
            .updateValue(false);
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
