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
    type NotebookDocument,
    WorkspaceEdit,
    Range,
    Position
} from 'vscode';
import { JupyterNotebookView, Telemetry } from '../../platform/common/constants';
import type { API } from '../vscode-notebook-perf/src/api';
import { IS_PERF_TEST, PerformanceExtensionId } from '../constants';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { sendTelemetryEvent } from '../../telemetry';
import { countCells } from '../utils/notebook';

(IS_PERF_TEST() ? suite : suite.skip)('Notebook Performance (@notebookPerformance)', function () {
    let api: API;
    let notebook: NotebookDocument;
    this.timeout(120_000);
    suiteSetup(async function () {
        this.timeout(120_000);
        const extension = extensions.getExtension<API>(PerformanceExtensionId)!;
        await extension.activate();
        api = extension.exports;
    });
    setup(async () => {
        await commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await commands.executeCommand('workbench.action.closeAllEditors');

        notebook = await workspace.openNotebookDocument(JupyterNotebookView, generateNotebookData(1_000));
        await window.showNotebookDocument(notebook);
        await commands.executeCommand('outline.focus');
        await commands.executeCommand('notebook.selectKernel', {
            id: 'perfController',
            extension: PerformanceExtensionId
        });
    });
    teardown(async () => {
        await commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await commands.executeCommand('workbench.action.closeAllEditors');
    });
    test('Text output', async () => runAndSendTelemetry('text'));
    test('Html output', async () => runAndSendTelemetry('html'));
    test('Image output', async () => runAndSendTelemetry('image'));
    test('Editing code cell', async () => editAndSendTelemetry(NotebookCellKind.Code));
    test('Editing markdown cell', async () => editAndSendTelemetry(NotebookCellKind.Markup));

    async function editAndSendTelemetry(cellKind: NotebookCellKind) {
        const cell = notebook.getCells().find((cell) => cell.kind === cellKind);
        if (!cell) {
            throw new Error('No cell found');
        }
        const rangeToClear = new Range(0, 0, cell.document.lineCount - 1, cell.document.lineAt(0).range.end.character);
        const edit = new WorkspaceEdit();
        edit.replace(cell.document.uri, rangeToClear, ``);
        await workspace.applyEdit(edit);

        const stopWatch = new StopWatch();
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < 500; i += 1) {
            const edit = new WorkspaceEdit();
            edit.insert(cell.document.uri, new Position(0, i), i.toString());
            promises.push(Promise.resolve(workspace.applyEdit(edit)));
        }
        await Promise.all(promises);
        const duration = stopWatch.elapsedTime;
        const { codeCellCount, markdownCellCount } = countCells(notebook);
        sendTelemetryEvent(Telemetry.NativeNotebookEditPerformance, { codeCellCount, markdownCellCount, duration });
    }

    async function runAndSendTelemetry(outputType: 'text' | 'html' | 'image') {
        const metrics = await api.executeNotebook(outputType);
        const { codeCellCount, markdownCellCount } = countCells(notebook);
        sendTelemetryEvent(
            Telemetry.NativeNotebookExecutionPerformance,
            { ...metrics, codeCellCount, markdownCellCount },
            { outputType }
        );
    }

    function generateNotebookData(cellCount: number) {
        const markdownCellContents = ['# Header1', '## Header2', '### Header3', 'Hello World'].join('\n');
        let cellIndex = 0;
        let codeCellNumber = 0;
        const cells: NotebookCellData[] = [];
        while (true) {
            const cellKind = cellIndex % 2 === 0 ? NotebookCellKind.Code : NotebookCellKind.Markup;
            if (cellKind === NotebookCellKind.Code) {
                codeCellNumber += 1;
            }
            const code = cellKind === NotebookCellKind.Code ? `print(${codeCellNumber})` : markdownCellContents;
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
