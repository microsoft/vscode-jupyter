// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as sinon from 'sinon';
import { commands, ConfigurationTarget, Memento, NotebookEditor, window, workspace } from 'vscode';
import { traceInfo } from '../../../platform/logging';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposable,
    IJupyterSettings,
    IMemento,
    ReadWrite,
    WidgetCDNs
} from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, startJupyterServer, waitForCondition } from '../../common';
import { initialize } from '../../initialize';
import {
    assertHasTextOutputInVSCode,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout,
    prewarmNotebooks,
    selectDefaultController
} from '../notebook/helper';
import {
    assertOutputContainsHtml,
    clickWidget,
    executeCellAndDontWaitForOutput,
    executeCellAndWaitForOutput,
    initializeNotebookForWidgetTest
} from './standardWidgets.vscode.common.test';
import { GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/cdnWidgetScriptSourceProvider';
import { initializeWidgetComms, Utils } from './commUtils';
import { isWeb } from '../../../platform/common/utils/misc';

[true, false].forEach((useCDN) => {
    /* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
    suite(`Third party IPyWidget Tests ${useCDN ? 'with CDN' : 'without CDN'} @widgets`, function () {
        let api: IExtensionTestApi;
        const disposables: IDisposable[] = [];

        this.timeout(120_000);
        const widgetScriptSourcesValue: WidgetCDNs[] = useCDN ? ['jsdelivr.com', 'unpkg.com'] : [];
        // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
        this.retries(1);
        let editor: NotebookEditor;
        let comms: Utils;
        suiteSetup(async function () {
            if (isWeb()) {
                return this.skip();
            }
            traceInfo('Suite Setup VS Code Notebook - Execution');
            this.timeout(120_000);
            api = await initialize();
            const config = workspace.getConfiguration('jupyter', undefined);
            await config.update('widgetScriptSources', widgetScriptSourcesValue, ConfigurationTarget.Global);
            const configService = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
            const settings = configService.getSettings(undefined) as ReadWrite<IJupyterSettings>;
            settings.widgetScriptSources = widgetScriptSourcesValue;
            // Don't want any prompts on CI.
            const memento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
            await memento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, true);

            await startJupyterServer();
            await prewarmNotebooks();
            sinon.restore();
            editor = (await createEmptyPythonNotebook(disposables, undefined, true)).editor;
            await selectDefaultController(editor);
            // Widgets get rendered only when the output is in view. If we have a very large notebook
            // and the output is not visible, then it will not get rendered & the tests will fail. The tests inspect the rendered HTML.
            // Solution - maximize available real-estate by hiding the output panels & hiding the input cells.
            await commands.executeCommand('workbench.action.closePanel');
            await commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
            comms = await initializeWidgetComms(disposables);

            traceInfo('Suite Setup (completed)');
        });
        // Use same notebook without starting kernel in every single test (use one for whole suite).
        setup(async function () {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
            // With less real estate, the outputs might not get rendered (VS Code optimization to avoid rendering if not in viewport).
            await commands.executeCommand('workbench.action.closePanel');
        });
        teardown(async function () {
            traceInfo(`Ended Test ${this.currentTest?.title}`);
            if (this.currentTest?.isFailed()) {
                await captureScreenShot(this);
            }
            traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
        });
        suiteTeardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
        test('Slider Widget', async function () {
            await initializeNotebookForWidgetTest(disposables, { templateFile: 'slider_widgets.ipynb' }, editor);
            const cell = window.activeNotebookEditor?.notebook.cellAt(0)!;
            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['6519'], '.widget-readout');
        });

        test('Button Widget with custom comm message rendering a matplotlib widget', async () => {
            await initializeNotebookForWidgetTest(
                disposables,
                {
                    templateFile: 'button_widget_comm_msg_matplotlib.ipynb'
                },
                editor
            );
            const [cell0, cell1] = window.activeNotebookEditor!.notebook.getCells();

            await executeCellAndWaitForOutput(cell0, comms);
            await executeCellAndWaitForOutput(cell1, comms);
            await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);

            // Click the button and verify we have output in the same cell.
            await clickWidget(comms, cell0, 'button');
            await assertOutputContainsHtml(cell0, comms, ['>Figure 1<', '<canvas', 'Download plot']);
        });
        test.skip('Render AnyWidget (test js<-->kernel comms with binary data)', async function () {
            await initializeNotebookForWidgetTest(
                disposables,
                {
                    templateFile: 'ipywidgets.ipynb'
                },
                editor
            );
            const [, cell1, cell2, cell3, cell4] = window.activeNotebookEditor!.notebook.getCells();

            await executeCellAndWaitForOutput(cell1, comms);
            await assertOutputContainsHtml(cell1, comms, ['<button', 'Click Me']);

            // Click the button and verify the models get updated
            // & verify the changes in front end and kernel.
            await clickWidget(comms, cell1, 'button');

            // Verify the state of the UI.
            await assertOutputContainsHtml(cell1, comms, ['Button Clicked']);

            // Verify the state of the model in kernel.
            await executeCellAndWaitForOutput(cell2, comms);
            await assertHasTextOutputInVSCode(cell2, 'Hello World from JavaScript', undefined, false);
            await executeCellAndWaitForOutput(cell3, comms);
            await assertHasTextOutputInVSCode(cell3, 'Button Clicked', undefined, false);

            // Update the model in the kernel & verify the UI gets updated.
            await executeCellAndDontWaitForOutput(cell4);
            await assertOutputContainsHtml(cell1, comms, ['Value from Python']);
        });
        test('Render matplotlib, interactive inline', async function () {
            await initializeNotebookForWidgetTest(
                disposables,
                {
                    templateFile: 'matplotlib_widgets_interactive.ipynb'
                },
                editor
            );
            const cell = window.activeNotebookEditor!.notebook.cellAt(1);

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['>m<', '>b<', '<img src="data:image']);
        });
        test('Render matplotlib, non-interactive inline', async function () {
            await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'matplotlib_widgets_inline.ipynb'
            });
            const cell = window.activeNotebookEditor!.notebook.cellAt(2);

            const mimTypes = () =>
                cell.outputs.map((output) => output.items.map((item) => item.mime).join(',')).join(',');
            await executeCellAndDontWaitForOutput(cell);
            await waitForCondition(
                () => mimTypes().toLowerCase().includes('image/'),
                defaultNotebookTestTimeout,
                () => `Timeout waiting for matplotlib inline image, got ${mimTypes()}`
            );
        });
        test('Render matplotlib, widget', async function () {
            await initializeNotebookForWidgetTest(
                disposables,
                {
                    templateFile: 'matplotlib_widgets_widget.ipynb'
                },
                editor
            );
            const cell = window.activeNotebookEditor!.notebook.cellAt(3);

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['>Figure 1<', '<canvas', 'Download plot']);
        });
        test('Render matplotlib, widget in multiple cells', async function () {
            await initializeNotebookForWidgetTest(
                disposables,
                {
                    templateFile: 'matplotlib_multiple_cells_widgets.ipynb'
                },
                editor
            );
            const [, cell1, cell2, cell3] = window.activeNotebookEditor!.notebook.getCells();

            await executeCellAndDontWaitForOutput(cell1);
            await executeCellAndWaitForOutput(cell2, comms);
            await executeCellAndWaitForOutput(cell3, comms);
            await assertOutputContainsHtml(cell2, comms, ['>Figure', '<canvas', 'Download plot']);
            await assertOutputContainsHtml(cell3, comms, ['>Figure', '<canvas', 'Download plot']);
        });
    });
});
