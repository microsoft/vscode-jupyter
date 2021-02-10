// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-explicit-any,  */

import * as fakeTimers from '@sinonjs/fake-timers';
import * as sinon from 'sinon';
import { anything, instance, mock, when, verify, resetCalls } from 'ts-mockito';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../../client/common/application/types';
import { IBrowserService, IPersistentState, IPersistentStateFactory } from '../../client/common/types';
import { ShowBannerWithExpiryTime } from '../../client/datascience/dataScienceSurveyBanner';
import { initialize } from '../initialize';
import { noop } from '../../client/common/utils/misc';
import { UIKind } from 'vscode';
import * as localize from '../../client/common/utils/localize';
import { MillisecondsInADay } from '../../client/constants';
import {
    InsidersNativeNotebooksSurveyBanner,
    InsidersNotebookSurveyStateKeys
} from '../../client/datascience/insidersNativeNotebookSurveyBanner';
import { INotebookExtensibility } from '../../client/datascience/types';

suite('Insiders Native Notebooks Survey Banner', () => {
    let appShell: IApplicationShell;
    let browser: IBrowserService;
    let bannerService: InsidersNativeNotebooksSurveyBanner;
    let vscNotebook: IVSCodeNotebook;
    let persistentStateFactory: IPersistentStateFactory;
    let notebookExtensibility: INotebookExtensibility;
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
        vscNotebook = mock<IVSCodeNotebook>();
        appEnv = mock<IApplicationEnvironment>();
        persistentStateFactory = mock<IPersistentStateFactory>();
        notebookExtensibility = mock<INotebookExtensibility>();

        when(appEnv.uiKind).thenReturn(UIKind.Desktop);
        when(appEnv.channel).thenReturn('insiders');
        when(vscNotebook.onDidOpenNotebookDocument(anything(), anything(), anything())).thenReturn(noop as any);
        when(notebookExtensibility.onKernelStateChange(anything(), anything(), anything())).thenReturn(noop as any);
        const realStateFactory = api.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
        openNotebookCountState = realStateFactory.createGlobalPersistentState<number>(
            InsidersNotebookSurveyStateKeys.OpenNotebookCount,
            0
        );
        executionCountState = realStateFactory.createGlobalPersistentState<number>(
            InsidersNotebookSurveyStateKeys.ExecutionCount,
            0
        );
        showBannerState = realStateFactory.createGlobalPersistentState<ShowBannerWithExpiryTime>(
            InsidersNotebookSurveyStateKeys.ShowBanner,
            { data: true }
        );

        when(
            persistentStateFactory.createGlobalPersistentState(
                InsidersNotebookSurveyStateKeys.OpenNotebookCount,
                anything()
            )
        ).thenReturn(openNotebookCountState);
        when(
            persistentStateFactory.createGlobalPersistentState(
                InsidersNotebookSurveyStateKeys.ExecutionCount,
                anything()
            )
        ).thenReturn(executionCountState);
        when(
            persistentStateFactory.createGlobalPersistentState(InsidersNotebookSurveyStateKeys.ShowBanner, anything())
        ).thenReturn(showBannerState);
        when(
            persistentStateFactory.createGlobalPersistentState(
                InsidersNotebookSurveyStateKeys.ShowBanner,
                anything(),
                anything()
            )
        ).thenReturn(showBannerState);

        bannerService = createBannerService();
    });
    function createBannerService() {
        return new InsidersNativeNotebooksSurveyBanner(
            instance(appShell),
            instance(persistentStateFactory),
            instance(browser),
            instance(vscNotebook),
            true,
            instance(appEnv),
            instance(notebookExtensibility),
            []
        );
    }
    test('Confirm prompt is displayed & only once per session', async () => {
        when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve();
        await showBannerState.updateValue({ data: true });
        await executionCountState.updateValue(100);

        await bannerService.showBanner();
        await bannerService.showBanner();
        await bannerService.showBanner();

        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
    });
    test('Confirm prompt is displayed 3 months later', async () => {
        when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
            localize.DataScienceSurveyBanner.bannerLabelNo() as any
        );
        await showBannerState.updateValue({ data: true });
        await executionCountState.updateValue(100);

        await bannerService.showBanner();

        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
        resetCalls(appShell);

        // Attempt to display again & it won't.
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();

        // Advance time by 1 month & still not displayed.
        clock.tick(MillisecondsInADay * 30);
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();

        // Advance time by 3.5 month & it will be displayed.
        clock.tick(MillisecondsInADay * 30 * 3.5);
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
    });
    test('Confirm prompt is displayed 6 months later & survey displayed', async () => {
        when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
            localize.DataScienceSurveyBanner.bannerLabelYes() as any
        );

        await showBannerState.updateValue({ data: true });
        await executionCountState.updateValue(100);

        await bannerService.showBanner();
        verify(browser.launch(anything())).once();
        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
        resetCalls(browser);
        resetCalls(appShell);

        // Attempt to display again & it won't.
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();

        // Advance time by 1 month & still not displayed.
        clock.tick(MillisecondsInADay * 30);
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();

        // Advance time by 6.5 month & it will be displayed.
        clock.tick(MillisecondsInADay * 30 * 6.5);
        when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
            localize.DataScienceSurveyBanner.bannerLabelNo() as any
        );
        bannerService = createBannerService();
        await bannerService.showBanner();
        verify(browser.launch(anything())).never();
        verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
    });
});
