// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Event, EventEmitter, UIKind } from 'vscode';
import { IApplicationEnvironment, IApplicationShell } from '../common/application/types';
import '../common/extensions';
import {
    BANNER_NAME_DS_SURVEY,
    BANNER_NAME_INSIDERS_NOTEBOOKS_SURVEY,
    IBrowserService,
    IJupyterExtensionBanner,
    IPersistentState,
    IPersistentStateFactory
} from '../common/types';
import * as localize from '../common/utils/localize';
import { noop } from '../common/utils/misc';
import { MillisecondsInADay } from '../constants';
import { InteractiveWindowMessages, IReExecuteCells } from './interactive-common/interactiveWindowTypes';
import { IInteractiveWindowListener, INotebookEditorProvider } from './types';

export enum DSSurveyStateKeys {
    ShowBanner = 'ShowDSSurveyBanner',
    OpenNotebookCount = 'DS_OpenNotebookCount',
    ExecutionCount = 'DS_ExecutionCount'
}

enum DSSurveyLabelIndex {
    Yes,
    No
}

const NotebookOpenThreshold = 5;
const NotebookExecutionThreshold = 100;

@injectable()
export class DataScienceSurveyBannerLogger implements IInteractiveWindowListener {
    // tslint:disable-next-line: no-any
    private postEmitter = new EventEmitter<{ message: string; payload: any }>();
    constructor(
        @inject(IPersistentStateFactory) private persistentState: IPersistentStateFactory,
        @inject(IJupyterExtensionBanner)
        @named(BANNER_NAME_DS_SURVEY)
        private readonly dataScienceSurveyBanner: IJupyterExtensionBanner,
        @inject(IJupyterExtensionBanner)
        @named(BANNER_NAME_INSIDERS_NOTEBOOKS_SURVEY)
        private readonly insidersNativeNotebooksSurveyBanner: IJupyterExtensionBanner
    ) {}
    // tslint:disable-next-line: no-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }
    // tslint:disable-next-line: no-any
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
                        return Promise.all([
                            this.dataScienceSurveyBanner.showBanner(),
                            this.insidersNativeNotebooksSurveyBanner.showBanner()
                        ]);
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
export class DataScienceSurveyBanner implements IJupyterExtensionBanner {
    public get enabled(): boolean {
        if (this.applicationEnvironment.uiKind !== UIKind.Desktop || this.applicationEnvironment.channel !== 'stable') {
            return false;
        }
        if (!this.showBannerState.value.expiry) {
            return true;
        }
        return this.showBannerState.value.expiry! < Date.now();
    }
    private disabledInCurrentSession: boolean = false;
    private bannerMessage: string = localize.DataScienceSurveyBanner.bannerMessage();
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
        @inject(INotebookEditorProvider) editorProvider: INotebookEditorProvider,
        @inject(IApplicationEnvironment) private applicationEnvironment: IApplicationEnvironment,
        surveyLink: string = 'https://aka.ms/pyaisurvey'
    ) {
        this.surveyLink = surveyLink;
        this.showBannerState = this.persistentState.createGlobalPersistentState<ShowBannerWithExpiryTime>(
            DSSurveyStateKeys.ShowBanner,
            {
                data: true
            }
        );
        editorProvider.onDidOpenNotebookEditor(this.openedNotebook.bind(this));
    }
    public async showBanner(): Promise<void> {
        if (!this.enabled || this.disabledInCurrentSession) {
            return;
        }
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

        return executionCount >= NotebookExecutionThreshold || notebookOpenCount > NotebookOpenThreshold;
    }

    public async launchSurvey(): Promise<void> {
        this.browserService.launch(this.surveyLink);
    }
    private async disable(monthsTillNextPrompt: number) {
        await this.showBannerState.updateValue({
            expiry: monthsTillNextPrompt * 31 * MillisecondsInADay + Date.now(),
            data: true
        });
    }

    private getOpenNotebookCount(): number {
        const state = this.persistentState.createGlobalPersistentState<number>(DSSurveyStateKeys.OpenNotebookCount, 0);
        return state.value;
    }

    private getExecutionCount(): number {
        const state = this.persistentState.createGlobalPersistentState<number>(DSSurveyStateKeys.ExecutionCount, 0);
        return state.value;
    }

    private async openedNotebook() {
        const state = this.persistentState.createGlobalPersistentState<number>(DSSurveyStateKeys.OpenNotebookCount, 0);
        await state.updateValue(state.value + 1);
        return this.showBanner();
    }
}
