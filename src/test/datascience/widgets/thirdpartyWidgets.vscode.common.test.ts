// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import {
    commands,
    ConfigurationTarget,
    Memento,
    NotebookCell,
    NotebookEditor,
    NotebookEditorRevealType,
    NotebookRange,
    window,
    workspace
} from 'vscode';
import { logger } from '../../../platform/logging';
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
    deleteAllCellsAndWait,
    insertCodeCell,
    prewarmNotebooks,
    selectDefaultController,
    waitForTextOutput
} from '../notebook/helper';
import {
    assertOutputContainsHtml,
    clickWidget,
    executeCellAndDontWaitForOutput,
    executeCellAndWaitForOutput,
    initializeNotebookForWidgetTest
} from './standardWidgets.vscode.common.test';
import { GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/cdnWidgetScriptSourceProvider';
import { hideOutputPanel, initializeWidgetComms, Utils } from './commUtils';
import { isWeb } from '../../../platform/common/utils/misc';
import { generateUuid } from '../../../platform/common/uuid';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';

[true, false].forEach((useCDN) => {
    const suiteSuffix = `${useCDN ? 'with CDN' : 'without CDN'}`;
    /* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
    suite(`Third party IPyWidget Tests ${suiteSuffix} @widgets`, function () {
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
            if (useCDN) {
                return this.skip();
            }
            if (!useCDN && IS_REMOTE_NATIVE_TEST()) {
                return this.skip();
            }
            logger.info('Suite Setup VS Code Notebook - Execution');
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
            comms = initializeWidgetComms(disposables, editor);
            await selectDefaultController(editor);
            // Widgets get rendered only when the output is in view. If we have a very large notebook
            // and the output is not visible, then it will not get rendered & the tests will fail. The tests inspect the rendered HTML.
            // Solution - maximize available real-estate by hiding the output panels & hiding the input cells.
            await hideOutputPanel();
            await commands.executeCommand('workbench.action.maximizeEditorHideSidebar');

            logger.info('Suite Setup (completed)');
        });
        // Use same notebook without starting kernel in every single test (use one for whole suite).
        setup(async function () {
            logger.info(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            logger.info(`Start Test (completed) ${this.currentTest?.title}`);
            // With less real estate, the outputs might not get rendered (VS Code optimization to avoid rendering if not in viewport).
            await hideOutputPanel();
        });
        teardown(async function () {
            logger.info(`Ended Test ${this.currentTest?.title}`);
            if (this.currentTest?.isFailed()) {
                await captureScreenShot(this);
            }
            logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
        });
        suiteTeardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
        test(`Slider Widget ${suiteSuffix}`, async function () {
            await initializeNotebookForWidgetTest(disposables, { templateFile: 'slider_widgets.ipynb' }, editor);
            const cell = window.activeNotebookEditor?.notebook.cellAt(0)!;
            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['6519'], '.widget-readout');
        });

        test(`Button Widget with custom comm message rendering a matplotlib widget ${suiteSuffix}`, async function () {
            // https://github.com/microsoft/vscode-jupyter/issues/16861
            if (IS_REMOTE_NATIVE_TEST()) {
                return this.skip();
            }
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
        test(`Render AnyWidget (test js<-->kernel comms with binary data) ${suiteSuffix}`, async function () {
            // https://github.com/microsoft/vscode-jupyter/issues/16861
            if (IS_REMOTE_NATIVE_TEST()) {
                return this.skip();
            }
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
        test(`Render matplotlib, interactive inline ${suiteSuffix}`, async function () {
            await initializeNotebookForWidgetTest(
                disposables,
                {
                    templateFile: 'matplotlib_widgets_interactive.ipynb'
                },
                editor
            );
            const cell = window.activeNotebookEditor!.notebook.cellAt(1);

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['>m<', '>b<', '<img src="']);
        });
        test(`Render matplotlib, non-interactive inline ${suiteSuffix}`, async function () {
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
        test(`Render matplotlib, widget ${suiteSuffix}`, async function () {
            // https://github.com/microsoft/vscode-jupyter/issues/16861
            if (IS_REMOTE_NATIVE_TEST()) {
                return this.skip();
            }
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
        test.skip(`Render matplotlib, widget in multiple cells ${suiteSuffix}`, async function () {
            // https://github.com/microsoft/vscode-jupyter/issues/16861
            if (IS_REMOTE_NATIVE_TEST()) {
                return this.skip();
            }
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

        if (!useCDN) {
            test('#17554 preserves an ordinary display alongside captured widget output', async function () {
                this.retries(0);
                const id = generateUuid();
                const readyMarker = `widget-ready-${id}`;
                const capturedMarker = `widget-captured-${id}`;
                const sourceMarker = `source-${id}`;
                const updatedMarker = `updated-${id}`;
                const displayId = `display-${id}`;
                const widgetMime = 'application/vnd.jupyter.widget-view+json';
                await window.showNotebookDocument(editor.notebook, { viewColumn: editor.viewColumn });
                assert.strictEqual(
                    window.activeNotebookEditor?.notebook,
                    editor.notebook,
                    'Suite notebook is not active'
                );
                await deleteAllCellsAndWait();
                const origin = await insertCodeCell(
                    [
                        'import ipywidgets as widgets',
                        'from IPython.display import display',
                        'out = widgets.Output()',
                        `out.append_stdout(${JSON.stringify(
                            readyMarker + ' ipywidgets='
                        )} + widgets.__version__ + '\\n')`,
                        'display(out)',
                        `did = display(${JSON.stringify(sourceMarker)}, display_id=${JSON.stringify(displayId)})`
                    ].join('\n'),
                    { index: 0 }
                );
                const capture = await insertCodeCell(
                    `with out:\n    display(${JSON.stringify(capturedMarker)}, display_id=${JSON.stringify(displayId)})`
                );
                const updater = await insertCodeCell(`did.update(${JSON.stringify(updatedMarker)})`);
                await commands.executeCommand('notebook.cell.collapseAllCellInputs');
                const revealOrigin = () =>
                    editor.revealRange(
                        new NotebookRange(origin.index, origin.index + 1),
                        NotebookEditorRevealType.AtTop
                    );
                revealOrigin();

                const unexpectedOutputs: string[] = [];
                const outputSubscription = workspace.onDidChangeNotebookDocument((event) => {
                    if (event.notebook !== editor.notebook) {
                        return;
                    }
                    for (const change of event.cellChanges) {
                        if ((change.cell === capture || change.cell === updater) && change.outputs?.length) {
                            unexpectedOutputs.push(change.cell === capture ? 'capture' : 'updater');
                        }
                    }
                });
                try {
                    const execute = async (cell: NotebookCell) => {
                        await executeCellAndDontWaitForOutput(cell);
                        const summary = await waitForCondition(
                            () =>
                                typeof cell.executionSummary?.success === 'boolean' ? cell.executionSummary : undefined,
                            defaultNotebookTestTimeout,
                            `Cell ${cell.index + 1} has no execution result`
                        );
                        assert.isTrue(summary.success, `Cell ${cell.index + 1} failed`);
                    };
                    await execute(origin);
                    await waitForCondition(
                        () =>
                            origin.outputs.length === 2 &&
                            origin.outputs[0].items.some((item) => item.mime === widgetMime),
                        defaultNotebookTestTimeout,
                        'Origin did not produce a widget and an ordinary display'
                    );
                    await waitForTextOutput(origin, `'${sourceMarker}'`, 1);
                    assert.isTrue(origin.outputs[1].items.some((item) => item.mime === 'text/plain'));
                    const widgetData = origin.outputs[0].items.find((item) => item.mime === widgetMime)!.data.slice();
                    const modelId = (JSON.parse(new TextDecoder().decode(widgetData)) as { model_id?: string })
                        .model_id;
                    assert.isTrue(typeof modelId === 'string' && modelId.length > 0, 'Missing widget model');

                    await assertOutputContainsHtml(origin, comms, [readyMarker], '.widget-output');
                    assert.notInclude(await comms.queryHtml(origin, '.widget-output'), capturedMarker);

                    await execute(capture);
                    revealOrigin();
                    await assertOutputContainsHtml(origin, comms, [readyMarker, capturedMarker], '.widget-output');
                    assertHasTextOutputInVSCode(origin, `'${sourceMarker}'`, 1);

                    await execute(updater);
                    revealOrigin();
                    await waitForTextOutput(origin, `'${updatedMarker}'`, 1);
                    assert.lengthOf(origin.outputs, 2);
                    assert.isTrue(origin.outputs[1].items.some((item) => item.mime === 'text/plain'));
                    const widgetItems = origin.outputs.flatMap((output) =>
                        output.items.filter((item) => item.mime === widgetMime)
                    );
                    assert.lengthOf(widgetItems, 1);
                    assert.deepEqual(widgetItems[0].data, widgetData, 'Widget sibling changed');
                    await assertOutputContainsHtml(origin, comms, [readyMarker], '.widget-output');
                    assert.isAbove(capture.executionSummary!.executionOrder!, origin.executionSummary!.executionOrder!);
                    assert.isAbove(
                        updater.executionSummary!.executionOrder!,
                        capture.executionSummary!.executionOrder!
                    );
                    assert.isEmpty(capture.outputs, 'Capture cell emitted output');
                    assert.isEmpty(updater.outputs, 'Updater cell emitted output');
                    assert.isEmpty(unexpectedOutputs, 'An issuing cell briefly emitted output');
                } finally {
                    outputSubscription.dispose();
                }
            });
        }
    });
});
