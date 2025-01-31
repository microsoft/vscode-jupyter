// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { type NotebookDocument, NotebookCellKind, commands, extensions } from 'vscode';
import type { Jupyter } from '../../api';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../constants';
import { sleep } from '../core';

export function countCells(notebook: NotebookDocument) {
    let codeCellCount = 0;
    let markdownCellCount = 0;
    notebook.getCells().forEach((cell) => {
        if (cell.kind === NotebookCellKind.Code) {
            codeCellCount += 1;
        } else {
            markdownCellCount += 1;
        }
    });
    return { codeCellCount, markdownCellCount };
}

export async function startKernelUsingApiByRunningFirstAvailableCodeCell(notebook: NotebookDocument) {
    // For some reason VS Code does not send the execution request to the extension host.
    // Lets wait for at least 10s.
    // UI seems to take a while to load the notebook document.
    await sleep(10_000);
    // Run at least 1 cell, we need to ensure we have started the kernel.
    const codeCell = notebook.getCells().find((cell) => cell.kind === NotebookCellKind.Code);
    const firstCellRange = { start: codeCell!.index, end: codeCell!.index + 1 };
    void commands.executeCommand('notebook.cell.execute', {
        ranges: [firstCellRange],
        document: notebook.uri
    });

    const api = extensions.getExtension<Jupyter>(JVSC_EXTENSION_ID_FOR_TESTS)!.exports;
    const stopWatch = new StopWatch();
    const hasKernelStartedAndIsIdle = async () => {
        const kernel = await api.kernels.getKernel(notebook.uri);
        if (!kernel) {
            return false;
        }
        return kernel.status === 'idle';
    };

    while (!(await hasKernelStartedAndIsIdle())) {
        await sleep(1000);

        // Kernels can take a while to start (at least on windows)
        // Possible its very slow on CI, hence lets ensure we wait for at least 20s.
        if (stopWatch.elapsedTime > 20_000) {
            stopWatch.reset();
            void commands.executeCommand('notebook.cell.execute', {
                ranges: [firstCellRange],
                document: notebook.uri
            });
        }
    }
}
