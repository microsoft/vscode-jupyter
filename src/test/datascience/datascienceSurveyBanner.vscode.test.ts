// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-any max-func-body-length

import * as fakeTimers from '@sinonjs/fake-timers';
import * as sinon from 'sinon';
import { anything, instance, mock, when, verify, resetCalls } from 'ts-mockito';
import { IApplicationEnvironment, IApplicationShell } from '../../client/common/application/types';
import { IBrowserService, IPersistentState, IPersistentStateFactory } from '../../client/common/types';
import {
    DataScienceSurveyBanner,
    DSSurveyStateKeys,
    ShowBannerWithExpiryTime
} from '../../client/datascience/dataScienceSurveyBanner';
import { INotebookEditorProvider } from '../../client/datascience/types';
import { initialize } from '../initialize';
import { noop } from '../../client/common/utils/misc';
import { UIKind } from 'vscode';
import * as localize from '../../client/common/utils/localize';
import { MillisecondsInADay } from '../../client/constants';

suite('DataScience Survey Banner', () => {
    let appShell: IApplicationShell;
    let browser: IBrowserService;
    let bannerService: DataScienceSurveyBanner;
    let editorProvider: INotebookEditorProvider;
    let persistentStateFactory: IPersistentStateFactory;
    let executionCountState: IPersistentState<number>;
    let openNotebookCountState: IPersistentState<number>;
    let showBannerState: IPersistentState<ShowBannerWithExpiryTime>;
    let appEnv: IApplicationEnvironment;
    let clock: fakeTimers.InstalledClock;
    teardown(() => {
        sinon.restore();
        clock.uninstall();
    });
    setup(async () => {
        const api = await initialize();
        sinon.restore();
        clock = fakeTimers.install();
        appShell = mock<IApplicationShell>();
        browser = mock<IBrowserService>();
        editorProvider = mock<INotebookEditorProvider>();
        appEnv = mock<IApplicationEnvironment>();
        persistentStateFactory = mock<IPersistentStateFactory>();

        when(appEnv.uiKind).thenReturn(UIKind.Desktop);
        when(appEnv.channel).thenReturn('stable');
        when(editorProvider.onDidOpenNotebookEditor).thenReturn(noop as any);
        const realStateFactory = api.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
        openNotebookCountState = realStateFactory.createGlobalPersistentState<number>(
            DSSurveyStateKeys.OpenNotebookCount,
            0
        );
        executionCountState = realStateFactory.createGlobalPersistentState<number>(DSSurveyStateKeys.ExecutionCount, 0);
        showBannerState = realStateFactory.createGlobalPersistentState<ShowBannerWithExpiryTime>(
            DSSurveyStateKeys.ShowBanner,
            { data: true }
        );

        when(
            persistentStateFactory.createGlobalPersistentState(DSSurveyStateKeys.OpenNotebookCount, anything())
        ).thenReturn(openNotebookCountState);
        when(
            persistentStateFactory.createGlobalPersistentState(DSSurveyStateKeys.ExecutionCount, anything())
        ).thenReturn(executionCountState);
        when(persistentStateFactory.createGlobalPersistentState(DSSurveyStateKeys.ShowBanner, anything())).thenReturn(
            showBannerState
        );
        when(
            persistentStateFactory.createGlobalPersistentState(DSSurveyStateKeys.ShowBanner, anything(), anything())
        ).thenReturn(showBannerState);

        bannerService = createBannerService();
    });
    function createBannerService(){
        return new DataScienceSurveyBanner(
            instance(appShell),
            instance(persistentStateFactory),
            instance(browser),
            instance(editorProvider),
            instance(appEnv)
        );
    }
    test('Confirm prompt is displayed & only once per session', async () => {
        when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve();
        await showBannerState.updateValue({ data: true });
        await executionCountState.updateValue(100);

        await bannerService.showBanner();
        await bannerService.showBanner();
        await bannerService.showBanner();

        verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
    });
    test('Confirm prompt is displayed 3 months later', async () => {
        when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
            localize.DataScienceSurveyBanner.bannerLabelNo() as any
        );
        await showBannerState.updateValue({ data: true });
        await executionCountState.updateValue(100);

        await bannerService.showBanner();

        verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
        resetCalls(appShell);

        // Attempt to display again & it won't.
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

        // Advance time by 1 month & still not displayed.
        clock.tick(MillisecondsInADay * 30);
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

        // Advance time by 3.5 month & it will be displayed.
        clock.tick(MillisecondsInADay * 30 * 3.5);
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
    });
    test('Confirm prompt is displayed 6 months later & survey displayed', async () => {
        when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
            localize.DataScienceSurveyBanner.bannerLabelYes() as any
        );

        await showBannerState.updateValue({ data: true });
        await executionCountState.updateValue(100);

        await bannerService.showBanner();
        verify(browser.launch(anything())).once();
        verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
        resetCalls(browser);
        resetCalls(appShell);

        // Attempt to display again & it won't.
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

        // Advance time by 1 month & still not displayed.
        clock.tick(MillisecondsInADay * 30);
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

        // Advance time by 6.5 month & it will be displayed.
        clock.tick(MillisecondsInADay * 30 * 6.5);
        when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
            localize.DataScienceSurveyBanner.bannerLabelNo() as any
        );
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
    });
});
