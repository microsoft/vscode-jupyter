// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-any max-func-body-length

import { expect } from 'chai';
import { instance, mock, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { EventEmitter } from 'vscode';
import { NotebookDocument } from '../../../types/vscode-proposed';
import { ApplicationEnvironment } from '../../client/common/application/applicationEnvironment';
import { VSCodeNotebook } from '../../client/common/application/notebook';
import { IApplicationShell } from '../../client/common/application/types';
import { Experiments } from '../../client/common/experiments/groups';
import { ExperimentService } from '../../client/common/experiments/service';
import { IBrowserService, IPersistentState, IPersistentStateFactory } from '../../client/common/types';
import {
    InsidersNativeNotebooksSurveyBanner,
    InsidersNotebookSurveyStateKeys
} from '../../client/datascience/insidersNativeNotebookSurveyBanner';

suite('Insiders Notebook Survey Banner', () => {
    let appShell: typemoq.IMock<IApplicationShell>;
    let browser: typemoq.IMock<IBrowserService>;
    const targetUri: string = 'https://microsoft.com';

    const message = 'Can you please take a minute to tell us about your notebooks experience in VS Code?';
    const yes = 'Yes, take survey now';
    const no = 'No, thanks';

    async function runTestAndVerifyResults(testBanner: InsidersNativeNotebooksSurveyBanner) {
        const expectedUri: string = targetUri;
        let receivedUri: string = '';
        browser
            .setup((b) =>
                b.launch(
                    typemoq.It.is((a: string) => {
                        receivedUri = a;
                        return a === expectedUri;
                    })
                )
            )
            .verifiable(typemoq.Times.once());
        await testBanner.launchSurvey();
        // This is technically not necessary, but it gives
        // better output than the .verifyAll messages do.
        expect(receivedUri).is.equal(expectedUri, 'Uri given to launch mock is incorrect.');

        // verify that the calls expected were indeed made.
        browser.verifyAll();
        browser.reset();
    }

    setup(() => {
        appShell = typemoq.Mock.ofType<IApplicationShell>();
        browser = typemoq.Mock.ofType<IBrowserService>();
    });

    test('Show insiders native notebooks survey banner if we hit our cell execution count', async () => {
        const enabledValue: boolean = true;
        const testBanner: InsidersNativeNotebooksSurveyBanner = preparePopup(
            100,
            9,
            enabledValue,
            appShell.object,
            browser.object,
            targetUri,
            'insiders',
            true
        );
        await runTestAndVerifyResults(testBanner);
    });

    test('Show insiders native notebooks survey banner if we hit our notebook open count', async () => {
        const enabledValue: boolean = true;
        const testBanner: InsidersNativeNotebooksSurveyBanner = preparePopup(
            0,
            15,
            enabledValue,
            appShell.object,
            browser.object,
            targetUri,
            'insiders',
            true
        );
        await runTestAndVerifyResults(testBanner);
    });

    test('Do not show insiders native notebooks survey banner if user is in stable', () => {
        const enabledValue: boolean = true;
        const isInNativeNotebooksExperiment = true;
        const testBanner: InsidersNativeNotebooksSurveyBanner = preparePopup(
            101,
            6,
            enabledValue,
            appShell.object,
            browser.object,
            targetUri,
            'stable',
            isInNativeNotebooksExperiment
        );
        testBanner.showBanner().ignoreErrors();
    });

    test('Do not show insiders native notebooks survey banner if user is not using native notebooks', () => {
        // Possible user is in VSCode Insiders but has opted out of the Native Notebooks experiment
        const enabledValue: boolean = true;
        const isInNativeNotebooksExperiment = false;
        const testBanner: InsidersNativeNotebooksSurveyBanner = preparePopup(
            101,
            6,
            enabledValue,
            appShell.object,
            browser.object,
            targetUri,
            'insiders',
            isInNativeNotebooksExperiment
        );
        testBanner.showBanner().ignoreErrors();
    });

    test('Do not show insiders native notebooks survey banner if we have not hit our execution count or our notebook count', () => {
        appShell
            .setup((a) =>
                a.showInformationMessage(typemoq.It.isValue(message), typemoq.It.isValue(yes), typemoq.It.isValue(no))
            )
            .verifiable(typemoq.Times.never());
        const enabledValue: boolean = true;
        const testBanner: InsidersNativeNotebooksSurveyBanner = preparePopup(
            99,
            4,
            enabledValue,
            appShell.object,
            browser.object,
            targetUri,
            'insiders',
            true
        );
        testBanner.showBanner().ignoreErrors();
    });

    test("Do not show insiders native notebooks survey banner if it's been disabled", async () => {
        appShell
            .setup((a) =>
                a.showInformationMessage(typemoq.It.isValue(message), typemoq.It.isValue(yes), typemoq.It.isValue(no))
            )
            .verifiable(typemoq.Times.never());
        const enabledValue: boolean = false;
        const executionCount: number = 0;
        const notebookCount: number = 200;
        const testBanner: InsidersNativeNotebooksSurveyBanner = preparePopup(
            executionCount,
            notebookCount,
            enabledValue,
            appShell.object,
            browser.object,
            targetUri,
            'insiders',
            true
        );
        testBanner.showBanner().ignoreErrors();
    });
});

function preparePopup(
    executionCount: number,
    initialOpenCount: number,
    enabledValue: boolean,
    appShell: IApplicationShell,
    browser: IBrowserService,
    targetUri: string,
    channel: 'insiders' | 'stable',
    isInNativeNotebooksExperiment: boolean
): InsidersNativeNotebooksSurveyBanner {
    let openCount = 0;
    const myfactory: typemoq.IMock<IPersistentStateFactory> = typemoq.Mock.ofType<IPersistentStateFactory>();
    const enabledValState: typemoq.IMock<IPersistentState<boolean>> = typemoq.Mock.ofType<IPersistentState<boolean>>();
    const executionCountState: typemoq.IMock<IPersistentState<number>> = typemoq.Mock.ofType<
        IPersistentState<number>
    >();
    const openCountState: typemoq.IMock<IPersistentState<number>> = typemoq.Mock.ofType<IPersistentState<number>>();
    const provider = mock(VSCodeNotebook);
    (instance(provider) as any).then = undefined;
    const openedEventEmitter = new EventEmitter<NotebookDocument>();
    when(provider.onDidOpenNotebookDocument).thenReturn(openedEventEmitter.event);
    const applicationEnvironment = mock(ApplicationEnvironment);
    when(applicationEnvironment.channel).thenReturn(channel);
    const experimentService = mock(ExperimentService);
    when(experimentService.inExperiment(Experiments.NativeNotebook)).thenResolve(isInNativeNotebooksExperiment);
    enabledValState
        .setup((a) => a.updateValue(typemoq.It.isValue(true)))
        .returns(() => {
            enabledValue = true;
            return Promise.resolve();
        });
    enabledValState
        .setup((a) => a.updateValue(typemoq.It.isValue(false)))
        .returns(() => {
            enabledValue = false;
            return Promise.resolve();
        });

    executionCountState
        .setup((a) => a.updateValue(typemoq.It.isAnyNumber()))
        .returns(() => {
            executionCount += 1;
            return Promise.resolve();
        });
    openCountState
        .setup((a) => a.updateValue(typemoq.It.isAnyNumber()))
        .returns((v) => {
            openCount = v;
            return Promise.resolve();
        });

    enabledValState.setup((a) => a.value).returns(() => enabledValue);
    executionCountState.setup((a) => a.value).returns(() => executionCount);
    openCountState.setup((a) => a.value).returns(() => openCount);

    myfactory
        .setup((a) =>
            a.createGlobalPersistentState(
                typemoq.It.isValue(InsidersNotebookSurveyStateKeys.ShowBanner),
                typemoq.It.isValue(true)
            )
        )
        .returns(() => {
            return enabledValState.object;
        });
    myfactory
        .setup((a) =>
            a.createGlobalPersistentState(
                typemoq.It.isValue(InsidersNotebookSurveyStateKeys.ShowBanner),
                typemoq.It.isValue(true),
                typemoq.It.isAnyNumber()
            )
        )
        .returns(() => {
            return enabledValState.object;
        });
    myfactory
        .setup((a) =>
            a.createGlobalPersistentState(
                typemoq.It.isValue(InsidersNotebookSurveyStateKeys.ShowBanner),
                typemoq.It.isValue(false),
                typemoq.It.isAnyNumber()
            )
        )
        .returns(() => {
            return enabledValState.object;
        });
    myfactory
        .setup((a) =>
            a.createGlobalPersistentState(
                typemoq.It.isValue(InsidersNotebookSurveyStateKeys.ExecutionCount),
                typemoq.It.isAnyNumber()
            )
        )
        .returns(() => {
            return executionCountState.object;
        });
    myfactory
        .setup((a) =>
            a.createGlobalPersistentState(
                typemoq.It.isValue(InsidersNotebookSurveyStateKeys.OpenNotebookCount),
                typemoq.It.isAnyNumber()
            )
        )
        .returns(() => {
            return openCountState.object;
        });
    const result = new InsidersNativeNotebooksSurveyBanner(
        appShell,
        myfactory.object,
        browser,
        instance(provider),
        instance(experimentService),
        instance(applicationEnvironment),
        targetUri
    );

    // Fire the number of opens specifed so that it behaves like the real editor
    for (let i = 0; i < initialOpenCount; i += 1) {
        openedEventEmitter.fire({} as any);
    }

    return result;
}
