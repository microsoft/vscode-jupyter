// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { expect } from 'chai';
import {
    NotebookCell,
    NotebookCellExecutionSummary,
    NotebookDocument,
    NotebookEditor,
    NotebookEditorRevealType,
    NotebookRange,
    TextDocument,
    Uri,
    WindowState
} from 'vscode';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { JupyterNotebookView, InteractiveWindowView } from '../../platform/common/constants';
import { JupyterSettings } from '../../platform/common/configSettings';
import { ConfigurationService } from '../../platform/common/configuration/service.node';
import {
    CellCompletionNotificationMode,
    IConfigurationService,
    IDisposable,
    IWatchableJupyterSettings
} from '../../platform/common/types';
import { NotebookCellExecutionState, notebookCellExecutions } from '../../platform/notebooks/cellExecutionStateService';
import { dispose } from '../../platform/common/utils/lifecycle';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../test/vscode-mock';
import { CellCompletionNotificationService } from './cellCompletionNotificationService';

suite('Cell Completion Notification Service', () => {
    let clock: fakeTimers.InstalledClock;
    let disposables: IDisposable[];
    let configurationMock: IConfigurationService;
    let configuration: IConfigurationService;
    let settings: IWatchableJupyterSettings;
    let mode: CellCompletionNotificationMode;
    let failureMode: CellCompletionNotificationMode;
    let minimumDuration: number;
    let focused: boolean;

    setup(() => {
        resetVSCodeMocks();
        clock = fakeTimers.install();
        disposables = [];
        mode = 'always';
        failureMode = 'off';
        minimumDuration = 60;
        focused = false;

        const settingsMock = mock<IWatchableJupyterSettings>();
        when(settingsMock.cellCompletionNotificationMode).thenCall(() => mode);
        when(settingsMock.cellCompletionNotificationFailureMode).thenCall(() => failureMode);
        when(settingsMock.cellCompletionNotificationMinimumDuration).thenCall(() => minimumDuration);
        settings = instance(settingsMock);

        configurationMock = mock<IConfigurationService>();
        when(configurationMock.getSettings(anything())).thenReturn(settings);
        configuration = instance(configurationMock);

        when(mockedVSCodeNamespaces.window.state).thenCall(() => ({ focused }) as WindowState);
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), 'Show Cell')).thenResolve(undefined);

        const service = new CellCompletionNotificationService(disposables, configuration);
        service.activate();
    });

    teardown(() => {
        disposables = dispose(disposables);
        clock.uninstall();
    });

    test('Configuration defaults notifications to off with a 60-second threshold', () => {
        const actualSettings = new ConfigurationService().getSettings(Uri.file('defaults.ipynb'));

        expect(actualSettings).to.be.instanceOf(JupyterSettings);
        expect(actualSettings.cellCompletionNotificationMode).to.equal('off');
        expect(actualSettings.cellCompletionNotificationFailureMode).to.equal('off');
        expect(actualSettings.cellCompletionNotificationMinimumDuration).to.equal(60);
    });

    test('Does not notify when mode is off', async () => {
        mode = 'off';
        const notebook = createNotebook(1);

        executeCellGroup(notebook, [{ duration: 60_000, success: true }]);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything())).never();
    });

    test('Does not notify a focused window in windowNotFocused mode', async () => {
        mode = 'windowNotFocused';
        focused = true;
        const notebook = createNotebook(1);

        executeCellGroup(notebook, [{ duration: 60_000, success: true }]);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything())).never();
    });

    test('Failure mode can notify failures while the general mode is off', async () => {
        mode = 'off';
        failureMode = 'windowNotFocused';
        minimumDuration = 1;
        const completedNotebook = createNotebook(1, JupyterNotebookView, Uri.file('completed.ipynb'));
        const failedNotebook = createNotebook(1, JupyterNotebookView, Uri.file('failed.ipynb'));

        executeCellGroup(completedNotebook, [{ duration: 1_000, success: true }]);
        executeCellGroup(failedNotebook, [{ duration: 1_000, success: false }]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in completed.ipynb completed after 1 second.',
                'Show Cell'
            )
        ).never();
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in failed.ipynb failed after 1 second.',
                'Show Cell'
            )
        ).once();
    });

    test('Reads a failure result published after the internal Idle event', async () => {
        mode = 'off';
        failureMode = 'always';
        minimumDuration = 1;
        focused = true;
        const notebook = createNotebook(1);

        notebookCellExecutions.requestNotebookCellExecution(notebook.cells);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Executing);
        clock.tick(1_000);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Idle);
        setTimeout(() => notebook.setResult(0, false), 25);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in test.ipynb failed after 1 second.',
                'Show Cell'
            )
        ).once();
    });

    test('Failure windowNotFocused mode does not notify a focused window', async () => {
        mode = 'off';
        failureMode = 'windowNotFocused';
        minimumDuration = 1;
        focused = true;
        const notebook = createNotebook(1);

        executeCellGroup(notebook, [{ duration: 1_000, success: false }]);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything())).never();
    });

    test('Failure always mode escalates above general windowNotFocused mode', async () => {
        mode = 'windowNotFocused';
        failureMode = 'always';
        minimumDuration = 1;
        focused = true;
        const notebook = createNotebook(1);

        executeCellGroup(notebook, [{ duration: 1_000, success: false }]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in test.ipynb failed after 1 second.',
                'Show Cell'
            )
        ).once();
    });

    test('Failure mode cannot weaken the general mode or bypass the duration threshold', async () => {
        failureMode = 'off';
        focused = true;
        const qualifyingNotebook = createNotebook(1, JupyterNotebookView, Uri.file('qualifying.ipynb'));
        const shortNotebook = createNotebook(1, JupyterNotebookView, Uri.file('short.ipynb'));

        executeCellGroup(qualifyingNotebook, [{ duration: 60_000, success: false }]);
        executeCellGroup(shortNotebook, [{ duration: 59_999, success: false }]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in qualifying.ipynb failed after 60 seconds.',
                'Show Cell'
            )
        ).once();
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in short.ipynb failed after 60 seconds.',
                'Show Cell'
            )
        ).never();
    });

    test('Uses resource-specific settings from the completed notebook', async () => {
        const disabledSettings = mock<IWatchableJupyterSettings>();
        when(disabledSettings.cellCompletionNotificationMode).thenReturn('off');
        when(disabledSettings.cellCompletionNotificationFailureMode).thenReturn('off');
        when(disabledSettings.cellCompletionNotificationMinimumDuration).thenReturn(1);
        const enabledSettings = mock<IWatchableJupyterSettings>();
        when(enabledSettings.cellCompletionNotificationMode).thenReturn('always');
        when(enabledSettings.cellCompletionNotificationFailureMode).thenReturn('off');
        when(enabledSettings.cellCompletionNotificationMinimumDuration).thenReturn(1);

        const disabledNotebook = createNotebook(1, JupyterNotebookView, Uri.file('disabled.ipynb'));
        const enabledNotebook = createNotebook(1, JupyterNotebookView, Uri.file('enabled.ipynb'));
        when(configurationMock.getSettings(disabledNotebook.notebook.uri)).thenReturn(instance(disabledSettings));
        when(configurationMock.getSettings(enabledNotebook.notebook.uri)).thenReturn(instance(enabledSettings));

        executeCellGroup(disabledNotebook, [{ duration: 1_000, success: true }]);
        executeCellGroup(enabledNotebook, [{ duration: 1_000, success: true }]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in disabled.ipynb completed after 1 second.',
                'Show Cell'
            )
        ).never();
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in enabled.ipynb completed after 1 second.',
                'Show Cell'
            )
        ).once();
    });

    test('Uses resource-specific failure modes from the completed notebook', async () => {
        focused = true;
        const disabledSettings = mock<IWatchableJupyterSettings>();
        when(disabledSettings.cellCompletionNotificationMode).thenReturn('off');
        when(disabledSettings.cellCompletionNotificationFailureMode).thenReturn('off');
        when(disabledSettings.cellCompletionNotificationMinimumDuration).thenReturn(1);
        const enabledSettings = mock<IWatchableJupyterSettings>();
        when(enabledSettings.cellCompletionNotificationMode).thenReturn('off');
        when(enabledSettings.cellCompletionNotificationFailureMode).thenReturn('always');
        when(enabledSettings.cellCompletionNotificationMinimumDuration).thenReturn(1);

        const disabledNotebook = createNotebook(1, JupyterNotebookView, Uri.file('disabled-failure.ipynb'));
        const enabledNotebook = createNotebook(1, JupyterNotebookView, Uri.file('enabled-failure.ipynb'));
        when(configurationMock.getSettings(disabledNotebook.notebook.uri)).thenReturn(instance(disabledSettings));
        when(configurationMock.getSettings(enabledNotebook.notebook.uri)).thenReturn(instance(enabledSettings));

        executeCellGroup(disabledNotebook, [{ duration: 1_000, success: false }]);
        executeCellGroup(enabledNotebook, [{ duration: 1_000, success: false }]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in disabled-failure.ipynb failed after 1 second.',
                'Show Cell'
            )
        ).never();
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in enabled-failure.ipynb failed after 1 second.',
                'Show Cell'
            )
        ).once();
    });

    test('Always mode notifies a focused window at the exact threshold', async () => {
        focused = true;
        const notebook = createNotebook(1);

        executeCellGroup(notebook, [{ duration: 60_000, success: true }]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in test.ipynb completed after 60 seconds.',
                'Show Cell'
            )
        ).once();
        verify(configurationMock.getSettings(notebook.notebook.uri)).once();
    });

    test('Does not notify below the threshold', async () => {
        const notebook = createNotebook(1);

        executeCellGroup(notebook, [{ duration: 59_999, success: true }]);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything())).never();
    });

    test('Uses failed and stopped wording for a single cell', async () => {
        minimumDuration = 1;
        const failedNotebook = createNotebook(1, JupyterNotebookView, Uri.file('failed.ipynb'));
        executeCellGroup(failedNotebook, [{ duration: 1_000, success: false }]);
        await flushPromises();
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in failed.ipynb failed after 1 second.',
                'Show Cell'
            )
        ).once();

        const stoppedNotebook = createNotebook(1, JupyterNotebookView, Uri.file('stopped.ipynb'));
        executeCellGroup(stoppedNotebook, [{ duration: 1_000, success: undefined }]);
        await flushPromises();
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in stopped.ipynb stopped after 1 second.',
                'Show Cell'
            )
        ).once();
    });

    test('Uses the authoritative cancelled result when VS Code reports failure', async () => {
        minimumDuration = 1;
        const notebook = createNotebook(1);

        notebookCellExecutions.requestNotebookCellExecution(notebook.cells);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Executing);
        clock.tick(1_000);
        notebook.setResult(0, false);
        notebookCellExecutions.changeCellState(
            notebook.cells[0],
            NotebookCellExecutionState.Idle,
            undefined,
            'cancelled'
        );
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                'Cell 1 in test.ipynb stopped after 1 second.',
                'Show Cell'
            )
        ).once();
    });

    test('Aggregates individually short cells using whole-group duration', async () => {
        const notebook = createNotebook(2);

        executeCellGroup(notebook, [
            { duration: 30_000, success: true },
            { duration: 30_000, success: true }
        ]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                '2 cells in test.ipynb completed after 60 seconds.',
                'Show Cell'
            )
        ).once();
    });

    test('Completed batch reveals the final cell', async () => {
        minimumDuration = 1;
        const notebook = createNotebook(2);
        const reveals: [number, number, NotebookEditorRevealType | undefined][] = [];
        const editor = createNotebookEditor(reveals);
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), 'Show Cell')).thenReturn(
            Promise.resolve('Show Cell') as any
        );
        when(mockedVSCodeNamespaces.window.showNotebookDocument(anything())).thenReturn(Promise.resolve(editor) as any);

        executeCellGroup(notebook, [
            { duration: 500, success: true },
            { duration: 500, success: true }
        ]);
        await flushPromises();

        expect(reveals).to.deep.equal([[1, 2, NotebookEditorRevealType.InCenter]]);
    });

    test('Batch failure takes precedence and reveals the first failed cell', async () => {
        minimumDuration = 1;
        const notebook = createNotebook(3);
        const reveals: [number, number, NotebookEditorRevealType | undefined][] = [];
        const editor = createNotebookEditor(reveals);
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), 'Show Cell')).thenReturn(
            Promise.resolve('Show Cell') as any
        );
        when(mockedVSCodeNamespaces.window.showNotebookDocument(anything())).thenReturn(Promise.resolve(editor) as any);

        executeCellGroup(notebook, [
            { duration: 400, success: undefined },
            { duration: 300, success: false },
            { duration: 300, success: false }
        ]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                '3 cells in test.ipynb finished with errors after 1 second.',
                'Show Cell'
            )
        ).once();
        expect(reveals).to.deep.equal([[1, 2, NotebookEditorRevealType.InCenter]]);
    });

    test('Batch stopped result reveals the first stopped cell', async () => {
        minimumDuration = 1;
        const notebook = createNotebook(2);
        const reveals: [number, number, NotebookEditorRevealType | undefined][] = [];
        const editor = createNotebookEditor(reveals);
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), 'Show Cell')).thenReturn(
            Promise.resolve('Show Cell') as any
        );
        when(mockedVSCodeNamespaces.window.showNotebookDocument(anything())).thenReturn(Promise.resolve(editor) as any);

        executeCellGroup(notebook, [
            { duration: 500, success: true },
            { duration: 500, success: undefined }
        ]);
        await flushPromises();

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                '2 cells in test.ipynb stopped after 1 second.',
                'Show Cell'
            )
        ).once();
        expect(reveals).to.deep.equal([[1, 2, NotebookEditorRevealType.InCenter]]);
    });

    test('Silently ignores a stale reveal target', async () => {
        minimumDuration = 1;
        const notebook = createNotebook(1);
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), 'Show Cell')).thenReturn(
            Promise.resolve('Show Cell') as any
        );

        notebookCellExecutions.requestNotebookCellExecution(notebook.cells);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Executing);
        clock.tick(1_000);
        notebook.setResult(0, true);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Idle);
        notebook.setIndex(0, -1);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showNotebookDocument(anything())).never();
    });

    test('Ignores non-Jupyter notebooks and never-started groups', async () => {
        minimumDuration = 1;
        const interactive = createNotebook(1, InteractiveWindowView);
        executeCellGroup(interactive, [{ duration: 1_000, success: true }]);
        const otherNotebook = createNotebook(1, 'other-notebook');
        executeCellGroup(otherNotebook, [{ duration: 1_000, success: true }]);

        const neverStarted = createNotebook(1);
        notebookCellExecutions.requestNotebookCellExecution(neverStarted.cells);
        neverStarted.setResult(0, true);
        notebookCellExecutions.changeCellState(neverStarted.cells[0], NotebookCellExecutionState.Idle);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything())).never();
    });

    test('Does not notify after the notebook closes', async () => {
        minimumDuration = 1;
        const notebook = createNotebook(1);
        notebookCellExecutions.requestNotebookCellExecution(notebook.cells);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Executing);
        clock.tick(1_000);
        notebook.setClosed(true);
        notebook.setResult(0, true);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Idle);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything())).never();
    });

    test('Evaluates settings when the group completes', async () => {
        minimumDuration = 1;
        const notebook = createNotebook(1);
        notebookCellExecutions.requestNotebookCellExecution(notebook.cells);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Executing);
        clock.tick(1_000);
        mode = 'off';
        notebook.setResult(0, true);
        notebookCellExecutions.changeCellState(notebook.cells[0], NotebookCellExecutionState.Idle);
        await flushPromises();

        verify(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything())).never();
    });

    async function flushPromises() {
        await clock.runAllAsync();
        for (let index = 0; index < 5; index += 1) {
            await Promise.resolve();
        }
    }

    function executeCellGroup(
        notebook: TestNotebook,
        executions: { duration: number; success: boolean | undefined }[]
    ) {
        notebookCellExecutions.requestNotebookCellExecution(notebook.cells);
        executions.forEach((execution, index) => {
            notebookCellExecutions.changeCellState(notebook.cells[index], NotebookCellExecutionState.Executing);
            clock.tick(execution.duration);
            notebook.setResult(index, execution.success);
            notebookCellExecutions.changeCellState(notebook.cells[index], NotebookCellExecutionState.Idle);
        });
    }
});

type TestNotebook = {
    readonly notebook: NotebookDocument;
    readonly cells: NotebookCell[];
    setResult(index: number, success: boolean | undefined): void;
    setIndex(cell: number, index: number): void;
    setClosed(closed: boolean): void;
};

function createNotebook(
    cellCount: number,
    notebookType: string = JupyterNotebookView,
    uri: Uri = Uri.file('test.ipynb')
): TestNotebook {
    const notebookMock = mock<NotebookDocument>();
    const notebook = instance(notebookMock);
    let notebookClosed = false;
    const results = new Array<boolean | undefined>(cellCount).fill(undefined);
    const indices = Array.from({ length: cellCount }, (_, index) => index);
    const cells = Array.from({ length: cellCount }, (_, index) => {
        const document = mock<TextDocument>();
        when(document.isClosed).thenReturn(false);
        const cell = mock<NotebookCell>();
        when(cell.notebook).thenReturn(notebook);
        when(cell.document).thenReturn(instance(document));
        when(cell.index).thenCall(() => indices[index]);
        when(cell.executionSummary).thenCall(() => ({ success: results[index] }) as NotebookCellExecutionSummary);
        return instance(cell);
    });

    when(notebookMock.notebookType).thenReturn(notebookType);
    when(notebookMock.uri).thenReturn(uri);
    when(notebookMock.isClosed).thenCall(() => notebookClosed);
    when(notebookMock.cellCount).thenReturn(cellCount);
    when(notebookMock.cellAt(anything())).thenCall((index: number) => cells[index]);

    return {
        notebook,
        cells,
        setResult: (index, success) => (results[index] = success),
        setIndex: (cell, index) => (indices[cell] = index),
        setClosed: (closed) => (notebookClosed = closed)
    };
}

function createNotebookEditor(reveals: [number, number, NotebookEditorRevealType | undefined][]): NotebookEditor {
    return {
        revealRange: (range: NotebookRange, revealType?: NotebookEditorRevealType) => {
            reveals.push([range.start, range.end, revealType]);
        }
    } as unknown as NotebookEditor;
}
