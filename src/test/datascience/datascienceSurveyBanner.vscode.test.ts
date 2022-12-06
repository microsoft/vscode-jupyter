// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
export const __ = '';
// /* eslint-disable @typescript-eslint/no-explicit-any,  */

// import * as fakeTimers from '@sinonjs/fake-timers';
// import * as sinon from 'sinon';
// import { anything, instance, mock, when, verify, resetCalls } from 'ts-mockito';
// import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../../platform/common/application/types';
// import { IBrowserService, IPersistentState, IPersistentStateFactory } from '../../platform/common/types';
// import {
//     BannerType,
//     DataScienceSurveyBanner,
//     DSSurveyStateKeys,
//     InsidersNotebookSurveyStateKeys,
//     ShowBannerWithExpiryTime
// } from '../../platform/datascience/dataScienceSurveyBanner';
// import { INotebookEditorProvider, INotebookExtensibility } from '../../platform/datascience/types';
// import { noop } from '../../platform/common/utils/misc';
// import { UIKind } from 'vscode';
// import * as localize from '../../platform/common/utils/localize';
// import { MillisecondsInADay } from '../../platform/constants';
// import { TestPersistentStateFactory } from './testPersistentStateFactory';
// import { MockMemento } from '../mocks/mementos';

// [true, false].forEach((UseVSCodeNotebookEditorApi) => {
//     const type = UseVSCodeNotebookEditorApi ? 'Insiders' : 'Stable';
//     const survey = UseVSCodeNotebookEditorApi ? BannerType.InsidersNotebookSurvey : BannerType.DSSurvey;

//     suite('Survey Banner - ' + type, () => {
//         let appShell: IApplicationShell;
//         let browser: IBrowserService;
//         let bannerService: DataScienceSurveyBanner;
//         let editorProvider: INotebookEditorProvider;
//         let persistentStateFactory: IPersistentStateFactory;
//         let executionCountState: IPersistentState<number>;
//         let openNotebookCountState: IPersistentState<number>;
//         let showBannerState: IPersistentState<ShowBannerWithExpiryTime>;
//         let appEnv: IApplicationEnvironment;
//         let vscodeNotebook: IVSCodeNotebook;
//         let notebookExtensibility: INotebookExtensibility;
//         let clock: fakeTimers.InstalledClock;
//         teardown(() => {
//             sinon.restore();
//             clock.uninstall();
//         });
//         setup(async () => {
//             sinon.restore();
//             clock = fakeTimers.install();
//             appShell = mock<IApplicationShell>();
//             browser = mock<IBrowserService>();
//             editorProvider = mock<INotebookEditorProvider>();
//             appEnv = mock<IApplicationEnvironment>();
//             persistentStateFactory = mock<IPersistentStateFactory>();
//             vscodeNotebook = mock<IVSCodeNotebook>();
//             notebookExtensibility = mock<INotebookExtensibility>();

//             when(appEnv.uiKind).thenReturn(UIKind.Desktop);
//             when(appEnv.channel).thenReturn(UseVSCodeNotebookEditorApi ? 'insiders' : 'stable');
//             when(editorProvider.onDidOpenNotebookEditor).thenReturn(noop as any);

//             // Fake up persistant storage as this tests has been hanging while trying to update the actual mementos
//             const globalStorage = new MockMemento();
//             const localStorage = new MockMemento();
//             const testStateFactory = new TestPersistentStateFactory(globalStorage, localStorage);

//             openNotebookCountState = testStateFactory.createGlobalPersistentState<number>(
//                 UseVSCodeNotebookEditorApi
//                     ? InsidersNotebookSurveyStateKeys.OpenNotebookCount
//                     : DSSurveyStateKeys.OpenNotebookCount,
//                 0
//             );
//             executionCountState = testStateFactory.createGlobalPersistentState<number>(
//                 UseVSCodeNotebookEditorApi
//                     ? InsidersNotebookSurveyStateKeys.ExecutionCount
//                     : DSSurveyStateKeys.ExecutionCount,
//                 0
//             );
//             showBannerState = testStateFactory.createGlobalPersistentState<ShowBannerWithExpiryTime>(
//                 UseVSCodeNotebookEditorApi ? InsidersNotebookSurveyStateKeys.ShowBanner : DSSurveyStateKeys.ShowBanner,
//                 { data: true }
//             );

//             when(
//                 persistentStateFactory.createGlobalPersistentState(
//                     UseVSCodeNotebookEditorApi
//                         ? InsidersNotebookSurveyStateKeys.OpenNotebookCount
//                         : DSSurveyStateKeys.OpenNotebookCount,
//                     anything()
//                 )
//             ).thenReturn(openNotebookCountState);
//             when(
//                 persistentStateFactory.createGlobalPersistentState(
//                     UseVSCodeNotebookEditorApi
//                         ? InsidersNotebookSurveyStateKeys.ExecutionCount
//                         : DSSurveyStateKeys.ExecutionCount,
//                     anything()
//                 )
//             ).thenReturn(executionCountState);
//             when(
//                 persistentStateFactory.createGlobalPersistentState(
//                     UseVSCodeNotebookEditorApi
//                         ? InsidersNotebookSurveyStateKeys.ShowBanner
//                         : DSSurveyStateKeys.ShowBanner,
//                     anything()
//                 )
//             ).thenReturn(showBannerState);
//             when(
//                 persistentStateFactory.createGlobalPersistentState(
//                     UseVSCodeNotebookEditorApi
//                         ? InsidersNotebookSurveyStateKeys.ShowBanner
//                         : DSSurveyStateKeys.ShowBanner,
//                     anything(),
//                     anything()
//                 )
//             ).thenReturn(showBannerState);

//             bannerService = createBannerService();
//         });
//         function createBannerService(isCodeSpace = false) {
//             return new DataScienceSurveyBanner(
//                 instance(appShell),
//                 instance(persistentStateFactory),
//                 instance(browser),
//                 instance(editorProvider),
//                 instance(appEnv),
//                 instance(vscodeNotebook),
//                 isCodeSpace,
//                 instance(notebookExtensibility),
//                 [],
//                 UseVSCodeNotebookEditorApi
//             );
//         }
//         test(type + ' - Confirm prompt is displayed (after 10 minutes) & only once per session', async () => {
//             when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve();
//             await showBannerState.updateValue({ data: true });
//             await executionCountState.updateValue(UseVSCodeNotebookEditorApi ? 100 : 250);

//             // Wait for the surveDelay
//             clock.tick(11 * 60 * 1000);

//             await bannerService.showBanner(survey);
//             await bannerService.showBanner(survey);
//             await bannerService.showBanner(survey);

//             verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
//         });
//         test(type + ' - Confirm prompt is not displayed in codespaces', async () => {
//             bannerService = createBannerService(true);

//             when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve();
//             await showBannerState.updateValue({ data: true });
//             await executionCountState.updateValue(100);

//             await bannerService.showBanner(survey);
//             await bannerService.showBanner(survey);
//             await bannerService.showBanner(survey);

//             verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
//         });
//         test(type + ' - Confirm prompt is displayed 3/6 months later', async () => {
//             when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
//                 localize.DataScienceSurveyBanner.bannerLabelNo() as any
//             );
//             await showBannerState.updateValue({ data: true });
//             await executionCountState.updateValue(UseVSCodeNotebookEditorApi ? 100 : 250);

//             // Wait for the surveDelay
//             clock.tick(11 * 60 * 1000);
//             await bannerService.showBanner(survey);

//             verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
//             resetCalls(appShell);

//             // Attempt to display again & it won't.
//             bannerService = createBannerService();
//             await bannerService.showBanner(survey);
//             verify(browser.launch(anything())).never();
//             verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

//             // Advance time by 1 month & still not displayed.
//             clock.tick(MillisecondsInADay * 30);
//             bannerService = createBannerService();
//             await bannerService.showBanner(survey);
//             verify(browser.launch(anything())).never();
//             verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

//             // Advance time by 6.5/3.5 month & it will be displayed.
//             const months = survey === BannerType.DSSurvey ? 6.5 : 3.5;
//             clock.tick(MillisecondsInADay * 30 * months);
//             bannerService = createBannerService();
//             // Wait for the surveDelay
//             clock.tick(11 * 60 * 1000);
//             await bannerService.showBanner(survey);
//             verify(browser.launch(anything())).never();
//             verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
//         });
//         test(type + ' - Confirm prompt is displayed 6/12 months later & survey displayed', async () => {
//             when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
//                 localize.DataScienceSurveyBanner.bannerLabelYes() as any
//             );

//             await showBannerState.updateValue({ data: true });
//             await executionCountState.updateValue(UseVSCodeNotebookEditorApi ? 100 : 250);

//             // Wait for the surveDelay
//             clock.tick(11 * 60 * 1000);

//             await bannerService.showBanner(survey);
//             verify(browser.launch(anything())).once();
//             verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
//             resetCalls(browser);
//             resetCalls(appShell);

//             // Attempt to display again & it won't.
//             bannerService = createBannerService();
//             await bannerService.showBanner(survey);
//             verify(browser.launch(anything())).never();
//             verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

//             // Advance time by 1 month & still not displayed.
//             clock.tick(MillisecondsInADay * 30);
//             bannerService = createBannerService();
//             await bannerService.showBanner(survey);
//             verify(browser.launch(anything())).never();
//             verify(appShell.showInformationMessage(anything(), anything(), anything())).never();

//             // Advance time by 12.5/6.5 month & it will be displayed.
//             const months = survey === BannerType.DSSurvey ? 12.5 : 6.5;
//             clock.tick(MillisecondsInADay * 30 * months);
//             when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
//                 localize.DataScienceSurveyBanner.bannerLabelNo() as any
//             );
//             // Wait for the surveDelay
//             clock.tick(11 * 60 * 1000);
//             bannerService = createBannerService();
//             await bannerService.showBanner(survey);
//             verify(browser.launch(anything())).never();
//             verify(appShell.showInformationMessage(anything(), anything(), anything())).once();
//         });
//     });
// });
