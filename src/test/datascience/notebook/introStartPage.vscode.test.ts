// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { instance, mock, when } from 'ts-mockito';
import { Memento } from 'vscode';
import { IApplicationEnvironment, ICommandManager } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { GLOBAL_MEMENTO, IDisposable, IExtensionContext, IMemento } from '../../../client/common/types';
import {
    IntroduceNativeNotebookDisplayed,
    IntroduceNativeNotebookStartPage
} from '../../../client/datascience/notebook/introStartPage';
import { INotebookEditorProvider, ITrustService } from '../../../client/datascience/types';
import { IExtensionTestApi, sleep, waitForCondition } from '../../common';
import { closeActiveWindows, initialize } from '../../initialize';
import { canRunNotebookTests, closeNotebooksAndCleanUpAfterTests } from './helper';
import { InsidersNotebookSurveyStateKeys } from '../../../client/datascience/dataScienceSurveyBanner';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this,  */
suite('DataScience - VSCode Notebook - Native Notebook Experiment', function () {
    this.timeout(60_000);

    let api: IExtensionTestApi;
    let memento: Memento;
    const disposables: IDisposable[] = [];
    let trustService: ITrustService;
    let commandManager: ICommandManager;
    let notebookEditorProvider: INotebookEditorProvider;
    let context: IExtensionContext;
    let appEnv: IApplicationEnvironment;
    let previousExecutionCount: number | undefined;
    let previousValueForStartPageDisplayed: boolean | undefined;
    const suiteDisposables: IDisposable[] = [];
    let nbPath: string;
    suiteSetup(async function () {
        traceInfo(`Start Suite Test`);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await closeNotebooksAndCleanUpAfterTests();
        notebookEditorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        memento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        context = api.serviceContainer.get<IExtensionContext>(IExtensionContext);
        trustService = api.serviceContainer.get<ITrustService>(ITrustService);
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        previousExecutionCount = memento.get<number | undefined>(InsidersNotebookSurveyStateKeys.OpenNotebookCount);
        previousValueForStartPageDisplayed = memento.get<boolean | undefined>(IntroduceNativeNotebookDisplayed);
        nbPath = path.join(context.extensionPath, 'resources/startNativeNotebooks.ipynb').toLowerCase();
        traceInfo(`Start Suite Test Complete`);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        appEnv = mock<IApplicationEnvironment>();
        sinon.restore();
        await memento.update(IntroduceNativeNotebookDisplayed, false);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        await closeActiveWindows();
    });
    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        if (typeof previousValueForStartPageDisplayed === 'boolean') {
            await memento.update(IntroduceNativeNotebookDisplayed, previousValueForStartPageDisplayed);
        }
        if (previousExecutionCount) {
            await memento.update(InsidersNotebookSurveyStateKeys.OpenNotebookCount, previousExecutionCount);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables.concat(suiteDisposables));
        traceInfo(`End Test (completed) ${this.currentTest?.title}`);
    });

    test('Do not display start page for VS Code Insiders', async () => {
        when(appEnv.channel).thenReturn('insiders');

        const startPage = new IntroduceNativeNotebookStartPage(
            true,
            commandManager,
            trustService,
            context,
            instance(appEnv),
            memento
        );

        await startPage.activate();

        // Wait for 1 second, and confirm that nothing was displayed.
        await sleep(1_000);

        assert.isUndefined(notebookEditorProvider.activeEditor);
        notebookEditorProvider.editors.map((item) =>
            assert.fail(item.file.fsPath, undefined, 'There should be no document open')
        );
        assert.equal(notebookEditorProvider.editors.length, 0);
    });
    test('Do not display start page for Stable VS Code Not in experiment', async () => {
        when(appEnv.channel).thenReturn('stable');
        await memento.update(InsidersNotebookSurveyStateKeys.ExecutionCount, 5);
        const startPage = new IntroduceNativeNotebookStartPage(
            false,
            commandManager,
            trustService,
            context,
            instance(appEnv),
            memento
        );

        await startPage.activate();

        // Wait for 1 second, and confirm that nothing was displayed.
        await sleep(1_000);

        assert.isUndefined(notebookEditorProvider.activeEditor);
        notebookEditorProvider.editors.map((item) =>
            assert.fail(item.file.fsPath, undefined, 'There should be no document open')
        );
        assert.equal(notebookEditorProvider.editors.length, 0);
    });
    test('Display start page for Stable VS Code in experiment', async () => {
        when(appEnv.channel).thenReturn('stable');
        await memento.update(InsidersNotebookSurveyStateKeys.ExecutionCount, 5);
        const startPage = new IntroduceNativeNotebookStartPage(
            true,
            commandManager,
            trustService,
            context,
            instance(appEnv),
            memento
        );

        await startPage.activate();

        await waitForCondition(
            async () =>
                memento.get<boolean>(IntroduceNativeNotebookDisplayed, false) === true &&
                !!notebookEditorProvider.activeEditor,
            1_000,
            'Memento not updated or no notebook dispalyed'
        );
        assert.isOk(notebookEditorProvider.activeEditor);
        assert.equal(notebookEditorProvider.editors.length, 1);
        assert.equal(notebookEditorProvider.activeEditor?.file.fsPath.toLocaleLowerCase(), nbPath);
    });
    test('Do not display start page for Stable VS Code in experiment if execution count is 0', async () => {
        when(appEnv.channel).thenReturn('stable');
        await memento.update(InsidersNotebookSurveyStateKeys.ExecutionCount, 0);
        const startPage = new IntroduceNativeNotebookStartPage(
            true,
            commandManager,
            trustService,
            context,
            instance(appEnv),
            memento
        );

        await startPage.activate();

        // Wait for 1 second, and confirm that nothing was displayed.
        await sleep(1_000);

        assert.isUndefined(notebookEditorProvider.activeEditor);
        notebookEditorProvider.editors.map((item) =>
            assert.fail(item.file.fsPath, undefined, 'There should be no document open')
        );
        assert.equal(notebookEditorProvider.editors.length, 0);
    });
    test('Display start page for Insider VS Code in experiment only once', async () => {
        when(appEnv.channel).thenReturn('stable');
        await memento.update(InsidersNotebookSurveyStateKeys.ExecutionCount, 5);
        const startPage = new IntroduceNativeNotebookStartPage(
            true,
            commandManager,
            trustService,
            context,
            instance(appEnv),
            memento
        );

        await startPage.activate();

        await waitForCondition(
            async () =>
                memento.get<boolean>(IntroduceNativeNotebookDisplayed, false) === true &&
                !!notebookEditorProvider.activeEditor,
            1_000,
            'Memento not updated or no notebook dispalyed'
        );
        assert.isOk(notebookEditorProvider.activeEditor);
        assert.equal(notebookEditorProvider.editors.length, 1);
        assert.equal(notebookEditorProvider.activeEditor?.file.fsPath.toLocaleLowerCase(), nbPath);

        await closeNotebooksAndCleanUpAfterTests();

        // We should not display the notebook again.
        // Even if we set execution count back to 0
        await memento.update(InsidersNotebookSurveyStateKeys.ExecutionCount, 0);
        await startPage.activate();
        await startPage.activate();
        await startPage.activate();

        // Wait for 1 second, and confirm that nothing was displayed.
        await sleep(1_000);

        assert.isUndefined(notebookEditorProvider.activeEditor);
        notebookEditorProvider.editors.map((item) =>
            assert.fail(item.file.fsPath, undefined, 'There should be no document open')
        );
        assert.equal(notebookEditorProvider.editors.length, 0);
    });
});
