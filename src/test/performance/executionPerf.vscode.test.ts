// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    window,
    extensions,
    NotebookCellKind,
    workspace,
    NotebookCellData,
    NotebookData,
    commands,
    type NotebookDocument
} from 'vscode';
import { JupyterNotebookView, Telemetry } from '../../platform/common/constants';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { sendTelemetryEvent } from '../../telemetry';
import { IS_PERF_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from '../constants.node';
import { PVSC_EXTENSION_ID, PythonExtension, type Environment } from '@vscode/python-extension';
import { PYTHON_PATH, sleep } from '../common.node';
import type { IExtensionApi } from '../../standalone/api';
import { DisposableStore } from '../../platform/common/utils/lifecycle';
import { countCells, startKernelUsingApiByRunningFirstAvailableCodeCell } from '../utils/notebook';

(IS_PERF_TEST() ? suite : suite.skip)('Extension Performance (@executionPerformance)', function () {
    let notebook: NotebookDocument;
    let activeEnv: Environment;
    this.timeout(120_000);
    const disposables = new DisposableStore();
    suiteSetup(async function () {
        this.timeout(120_000);
        const pythonExt = extensions.getExtension<PythonExtension>(PVSC_EXTENSION_ID)!;
        await Promise.all([extensions.getExtension(JVSC_EXTENSION_ID_FOR_TESTS)!.activate(), pythonExt.activate()]);

        // start this.
        const resolvedEnv = await pythonExt.exports.environments.resolveEnvironment(PYTHON_PATH);
        if (!resolvedEnv) {
            throw new Error(`Unable to resolve environment for ${PYTHON_PATH}`);
        }
        activeEnv = resolvedEnv;
    });
    setup(async () => {
        await commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await commands.executeCommand('workbench.action.closeAllEditors');
    });
    teardown(async () => {
        disposables.clear();
        await commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await commands.executeCommand('workbench.action.closeAllEditors');
    });
    test('Text output', async () => runAndSendTelemetry('text'));
    test('Html output', async () => runAndSendTelemetry('html'));
    test('Image output', async () => runAndSendTelemetry('image'));

    async function createAndSetupNotebook(outputType: 'text' | 'html' | 'image') {
        notebook = await workspace.openNotebookDocument(JupyterNotebookView, generateNotebookData(1_000, outputType));
        await window.showNotebookDocument(notebook);
        await commands.executeCommand('outline.focus');
        const jupyterExt = extensions.getExtension<IExtensionApi>(JVSC_EXTENSION_ID_FOR_TESTS)!.exports;
        await jupyterExt.openNotebook(notebook.uri, activeEnv);
    }

    async function runAndSendTelemetry(outputType: 'text' | 'html' | 'image') {
        await createAndSetupNotebook(outputType);
        const { duration } = await runAllCellsAndWaitForExecutionToComplete();
        const { codeCellCount, markdownCellCount } = countCells(notebook);
        sendTelemetryEvent(
            Telemetry.JupyterNotebookExecutionPerformance,
            { duration, codeCellCount, markdownCellCount },
            { outputType }
        );
    }
    async function runAllCellsAndWaitForExecutionToComplete() {
        await startKernelUsingApiByRunningFirstAvailableCodeCell(notebook);
        const stopWatch = new StopWatch();
        let duration = 0;
        void commands.executeCommand('notebook.cell.execute', {
            ranges: [{ start: 0, end: notebook.cellCount }],
            document: notebook.uri
        });

        let lastUpdateTime = Date.now();
        let startedUpdating = false;
        const getTimeElapsedSinceLastUpdate = () => (startedUpdating ? Date.now() - lastUpdateTime : 0);
        disposables.add(
            workspace.onDidChangeNotebookDocument(() => {
                lastUpdateTime = Date.now();
                startedUpdating = true;
                duration = stopWatch.elapsedTime;
            })
        );

        while (getTimeElapsedSinceLastUpdate() < 10_000) {
            await sleep(1000);
        }
        // Looks like no more updates are coming in.
        return { duration };
    }
    function generateNotebookData(cellCount: number, outputType: 'text' | 'html' | 'image') {
        const markdownCellContents = ['# Header1', '## Header2', '### Header3', 'Hello World'].join('\n');
        let cellIndex = 0;
        let codeCellNumber = 0;
        const cells: NotebookCellData[] = [];
        while (true) {
            let code = '';
            const cellKind = cellIndex % 2 === 0 ? NotebookCellKind.Code : NotebookCellKind.Markup;
            if (cellKind === NotebookCellKind.Code) {
                codeCellNumber += 1;
                code = `print(${codeCellNumber})`;
                if (outputType === 'html') {
                    code = `%%html\n<div>Hello World</div>`;
                } else if (outputType === 'image') {
                    code = [
                        `from IPython import display`,
                        `from base64 import b64decode`,
                        ``,
                        `base64_data = "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAApgAAAKYB3X3/OAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANCSURBVEiJtZZPbBtFFMZ/M7ubXdtdb1xSFyeilBapySVU8h8OoFaooFSqiihIVIpQBKci6KEg9Q6H9kovIHoCIVQJJCKE1ENFjnAgcaSGC6rEnxBwA04Tx43t2FnvDAfjkNibxgHxnWb2e/u992bee7tCa00YFsffekFY+nUzFtjW0LrvjRXrCDIAaPLlW0nHL0SsZtVoaF98mLrx3pdhOqLtYPHChahZcYYO7KvPFxvRl5XPp1sN3adWiD1ZAqD6XYK1b/dvE5IWryTt2udLFedwc1+9kLp+vbbpoDh+6TklxBeAi9TL0taeWpdmZzQDry0AcO+jQ12RyohqqoYoo8RDwJrU+qXkjWtfi8Xxt58BdQuwQs9qC/afLwCw8tnQbqYAPsgxE1S6F3EAIXux2oQFKm0ihMsOF71dHYx+f3NND68ghCu1YIoePPQN1pGRABkJ6Bus96CutRZMydTl+TvuiRW1m3n0eDl0vRPcEysqdXn+jsQPsrHMquGeXEaY4Yk4wxWcY5V/9scqOMOVUFthatyTy8QyqwZ+kDURKoMWxNKr2EeqVKcTNOajqKoBgOE28U4tdQl5p5bwCw7BWquaZSzAPlwjlithJtp3pTImSqQRrb2Z8PHGigD4RZuNX6JYj6wj7O4TFLbCO/Mn/m8R+h6rYSUb3ekokRY6f/YukArN979jcW+V/S8g0eT/N3VN3kTqWbQ428m9/8k0P/1aIhF36PccEl6EhOcAUCrXKZXXWS3XKd2vc/TRBG9O5ELC17MmWubD2nKhUKZa26Ba2+D3P+4/MNCFwg59oWVeYhkzgN/JDR8deKBoD7Y+ljEjGZ0sosXVTvbc6RHirr2reNy1OXd6pJsQ+gqjk8VWFYmHrwBzW/n+uMPFiRwHB2I7ih8ciHFxIkd/3Omk5tCDV1t+2nNu5sxxpDFNx+huNhVT3/zMDz8usXC3ddaHBj1GHj/As08fwTS7Kt1HBTmyN29vdwAw+/wbwLVOJ3uAD1wi/dUH7Qei66PfyuRj4Ik9is+hglfbkbfR3cnZm7chlUWLdwmprtCohX4HUtlOcQjLYCu+fzGJH2QRKvP3UNz8bWk1qMxjGTOMThZ3kvgLI5AzFfo379UAAAAASUVORK5CYII="`,
                        `display.Image(b64decode(base64_data))`
                    ].join('\n');
                }
            } else {
                code = markdownCellContents;
            }
            const language = cellKind === NotebookCellKind.Code ? 'python' : 'markdown';
            cells.push(new NotebookCellData(cellKind, code, language));
            cellIndex += 1;
            if (cellIndex >= cellCount) {
                break;
            }
        }

        return new NotebookData(cells);
    }
});
