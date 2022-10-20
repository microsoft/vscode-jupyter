// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as sinon from 'sinon';
import { commands, ConfigurationTarget, Memento, workspace } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
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
import { IKernelProvider } from '../../../kernels/types';
import { captureScreenShot, IExtensionTestApi, startJupyterServer, waitForCondition } from '../../common';
import { initialize } from '../../initialize';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    prewarmNotebooks
} from '../notebook/helper';
import {
    assertOutputContainsHtml,
    clickWidget,
    executeCellAndDontWaitForOutput,
    executeCellAndWaitForOutput,
    initializeNotebookForWidgetTest
} from './standardWidgets.vscode.common.test';
import { GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/cdnWidgetScriptSourceProvider';

[true, false].forEach((useCDN) => {
    /* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
    suite(`Third party IPyWidget Tests ${useCDN ? 'with CDN' : 'without CDN'}`, function () {
        let api: IExtensionTestApi;
        const disposables: IDisposable[] = [];
        let vscodeNotebook: IVSCodeNotebook;
        let kernelProvider: IKernelProvider;

        this.timeout(120_000);
        const widgetScriptSourcesValue: WidgetCDNs[] = useCDN ? ['jsdelivr.com', 'unpkg.com'] : [];
        // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
        this.retries(1);
        suiteSetup(async function () {
            traceInfo('Suite Setup VS Code Notebook - Execution');
            this.timeout(120_000);
            api = await initialize();
            const config = workspace.getConfiguration('jupyter', undefined);
            await config.update('widgetScriptSources', widgetScriptSourcesValue, ConfigurationTarget.Global);
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            const configService = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
            const settings = configService.getSettings(undefined) as ReadWrite<IJupyterSettings>;
            settings.widgetScriptSources = widgetScriptSourcesValue;
            // Don't want any prompts on CI.
            const memento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
            await memento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, true);

            await startJupyterServer();
            await prewarmNotebooks();
            sinon.restore();
            traceInfo('Suite Setup (completed)');
        });
        // Use same notebook without starting kernel in every single test (use one for whole suite).
        setup(async function () {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            await startJupyterServer();
            await closeNotebooks();
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
            // With less real estate, the outputs might not get rendered (VS Code optimization to avoid rendering if not in viewport).
            await commands.executeCommand('workbench.action.closePanel');
        });
        teardown(async function () {
            traceInfo(`Ended Test ${this.currentTest?.title}`);
            if (this.currentTest?.isFailed()) {
                await captureScreenShot(this);
            }
            await closeNotebooksAndCleanUpAfterTests(disposables);
            traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
        });
        suiteTeardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));

        test('Button Widget with custom comm message rendering a matplotlib widget', async () => {
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'button_widget_comm_msg_matplotlib.ipynb'
            });
            const [cell0, cell1] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

            await executeCellAndWaitForOutput(cell0, comms);
            await executeCellAndWaitForOutput(cell1, comms);
            await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);

            // Click the button and verify we have output in the same cell.
            await clickWidget(comms, cell0, 'button');
            await assertOutputContainsHtml(cell0, comms, ['>Figure 1<', '<canvas', 'Download plot']);
        });
        test('Render IPySheets', async function () {
            if (useCDN) {
                // https://github.com/microsoft/vscode-jupyter/issues/10506
                return this.skip();
            }
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'ipySheet_widgets.ipynb'
            });
            const [, cell1] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

            await executeCellAndWaitForOutput(cell1, comms);
            await assertOutputContainsHtml(cell1, comms, ['Hello', 'World', '42.000']);
        });
        test('Render IPySheets & search', async function () {
            if (useCDN) {
                // https://github.com/microsoft/vscode-jupyter/issues/10506
                return this.skip();
            }
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'ipySheet_widgets_search.ipynb'
            });
            const [, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

            await executeCellAndWaitForOutput(cell1, comms);
            await executeCellAndWaitForOutput(cell2, comms);
            await assertOutputContainsHtml(cell1, comms, ['title="Search:"', '<input type="text']);
            await assertOutputContainsHtml(cell2, comms, ['>train<', '>foo<']);

            // Update the textbox widget.
            await comms.setValue(cell1, '.widget-text input', 'train');
            await assertOutputContainsHtml(cell2, comms, ['class="htSearchResult">train<']);
        });
        test('Render IPySheets & slider', async function () {
            if (useCDN) {
                // https://github.com/microsoft/vscode-jupyter/issues/10506
                return this.skip();
            }
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'ipySheet_widgets_slider.ipynb'
            });
            const [, cell1, cell2, cell3] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

            await executeCellAndWaitForOutput(cell1, comms);
            await executeCellAndWaitForOutput(cell2, comms);
            await executeCellAndWaitForOutput(cell3, comms);
            await assertOutputContainsHtml(cell1, comms, ['Continuous Slider']);
            await assertOutputContainsHtml(cell2, comms, ['Continuous Text', '<input type="number']);
            await assertOutputContainsHtml(cell3, comms, ['Continuous Slider', '>0<', '>123.00']);

            // Update the textbox widget (for slider).
            await comms.setValue(cell2, '.widget-text input', '5255');
            await assertOutputContainsHtml(cell3, comms, ['>5255<', '>5378.0']);
        });
        test('Render ipyvolume (slider, color picker, figure)', async function () {
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'ipyvolume_widgets.ipynb'
            });
            const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);
            // ipyvolume fails in Python 3.10 due to a known issue.
            const kernel = kernelProvider.get(cell.notebook);
            if (
                kernel &&
                kernel.kernelConnectionMetadata.interpreter &&
                kernel.kernelConnectionMetadata.interpreter.version &&
                kernel.kernelConnectionMetadata.interpreter.version.major === 3 &&
                kernel.kernelConnectionMetadata.interpreter.version.minor === 10
            ) {
                return this.skip();
            }

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['<input type="color"', '>Slider1<', '>Slider2<', '<canvas']);
        });
        test('Render pythreejs', async function () {
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'pythreejs_widgets.ipynb'
            });
            const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['<canvas']);
        });
        test('Render pythreejs, 2', async function () {
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'pythreejs_widgets2.ipynb'
            });
            const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['<canvas']);
        });
        test('Render matplotlib, interactive inline', async function () {
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'matplotlib_widgets_interactive.ipynb'
            });
            const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['>m<', '>b<', '<img src="data:image']);
        });
        test('Render matplotlib, non-interactive inline', async function () {
            await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'matplotlib_widgets_inline.ipynb'
            });
            const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(2);

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
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'matplotlib_widgets_widget.ipynb'
            });
            const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(3);

            await executeCellAndWaitForOutput(cell, comms);
            await assertOutputContainsHtml(cell, comms, ['>Figure 1<', '<canvas', 'Download plot']);
        });
        test('Render matplotlib, widget in multiple cells', async function () {
            const comms = await initializeNotebookForWidgetTest(disposables, {
                templateFile: 'matplotlib_multiple_cells_widgets.ipynb'
            });
            const [, cell1, cell2, cell3] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

            await executeCellAndDontWaitForOutput(cell1);
            await executeCellAndWaitForOutput(cell2, comms);
            await executeCellAndWaitForOutput(cell3, comms);
            await assertOutputContainsHtml(cell2, comms, ['>Figure 1<', '<canvas', 'Download plot']);
            await assertOutputContainsHtml(cell3, comms, ['>Figure 2<', '<canvas', 'Download plot']);
        });
    });
});
