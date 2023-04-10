// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    NotebookCell,
    NotebookDocument,
    NotebookEditor,
    Position,
    TextDocument,
    Uri,
    ViewColumn
} from 'vscode';
import { IShowDataViewerFromVariablePanel } from './messageTypes';
import { Commands as DSCommands, CommandSource } from './platform/common/constants';
import { PythonEnvironment } from './platform/pythonEnvironments/info';
import { Channel } from './platform/common/application/types';
import { SelectJupyterUriCommandSource } from './kernels/jupyter/connection/serverSelector';

export type CommandsWithoutArgs = keyof ICommandNameWithoutArgumentTypeMapping;

/**
 * Mapping between commands and list or arguments.
 * These commands do NOT have any arguments.
 * @interface ICommandNameWithoutArgumentTypeMapping
 */
interface ICommandNameWithoutArgumentTypeMapping {
    ['workbench.action.showCommands']: [];
    ['workbench.action.debug.continue']: [];
    ['workbench.action.debug.stepOver']: [];
    ['workbench.action.debug.restart']: [];
    ['workbench.action.debug.stop']: [];
    ['workbench.action.reloadWindow']: [];
    ['workbench.action.closeActiveEditor']: [];
    ['editor.action.formatDocument']: [];
    ['editor.action.rename']: [];
    ['jupyter.selectJupyterInterpreter']: [];
    ['jupyterViewVariables.focus']: [];
    [DSCommands.RunCurrentCell]: [];
    [DSCommands.RunCurrentCellAdvance]: [];
    [DSCommands.CreateNewInteractive]: [];
    [DSCommands.InterruptKernel]: [{ notebookEditor: { notebookUri: Uri } } | undefined];
    [DSCommands.RestartKernel]: [{ notebookEditor: { notebookUri: Uri } } | undefined];
    [DSCommands.NotebookEditorRemoveAllCells]: [];
    [DSCommands.NotebookEditorRunAllCells]: [];
    [DSCommands.NotebookEditorAddCellBelow]: [];
    [DSCommands.ExpandAllCells]: [];
    [DSCommands.CollapseAllCells]: [];
    [DSCommands.ExportOutputAsNotebook]: [];
    [DSCommands.AddCellBelow]: [];
    [DSCommands.CreateNewNotebook]: [];
    [DSCommands.EnableDebugLogging]: [];
    [DSCommands.ResetLoggingLevel]: [];
    [DSCommands.OpenVariableView]: [];
    [DSCommands.OpenOutlineView]: [];
    [DSCommands.InteractiveClearAll]: [{ notebookEditor: { notebookUri: Uri } }];
    [DSCommands.InteractiveGoToCode]: [NotebookCell];
    [DSCommands.InteractiveCopyCell]: [NotebookCell];
    [DSCommands.InteractiveExportAsNotebook]: [{ notebookEditor: { notebookUri: Uri } }];
    [DSCommands.InteractiveExportAs]: [{ notebookEditor: { notebookUri: Uri } }];
    ['notebook.cell.quitEdit']: [];
    ['notebook.cell.executeAndSelectBelow']: [];
    ['notebook.cell.collapseCellOutput']: [];
    ['notebook.cell.expandCellOutput']: [];
}

type ContextKeyPrimitiveValue = null | undefined | boolean | number | string | Uri;

export type ContextKeyValue =
    | ContextKeyPrimitiveValue
    | Array<ContextKeyPrimitiveValue>
    | Record<string, ContextKeyPrimitiveValue>;

/**
 * Mapping between commands and list of arguments.
 * Used to provide strong typing for command & args.
 * @export
 * @interface ICommandNameArgumentTypeMapping
 * @extends {ICommandNameWithoutArgumentTypeMapping}
 */
export interface ICommandNameArgumentTypeMapping extends ICommandNameWithoutArgumentTypeMapping {
    ['vscode.openWith']: [Uri, string];
    ['jupyter.filterKernels']: [never];
    ['workbench.action.quickOpen']: [string];
    ['workbench.extensions.installExtension']: [
        Uri | 'ms-toolsai.jupyter' | 'ms-python.python',
        { context: { skipWalkthrough: boolean } }
    ];
    ['workbench.action.files.openFolder']: [];
    ['workbench.action.openWorkspace']: [];
    ['extension.open']: [string];
    ['setContext']: [string, ContextKeyValue] | ['jupyter.vscode.channel', Channel];
    ['jupyter.reloadVSCode']: [string];
    ['jupyter.runInDedicatedExtensionHost']: [string];
    ['revealLine']: [{ lineNumber: number; at: 'top' | 'center' | 'bottom' }];
    ['python._loadLanguageServerExtension']: {}[];
    ['python.SelectAndInsertDebugConfiguration']: [TextDocument, Position, CancellationToken];
    ['python.installPython']: [];
    ['vscode.open']: [Uri];
    ['notebook.execute']: [];
    ['notebook.cell.edit']: [];
    ['notebook.cell.execute']:
        | []
        | [{ ranges: { start: number; end: number }[]; document?: Uri; autoReveal?: boolean }]; // TODO update this
    ['notebook.cell.insertCodeCellBelow']: [];
    ['notebook.undo']: [];
    ['notebook.redo']: [];
    ['notebook.toggleBreakpointMargin']: [NotebookDocument];
    ['vscode.open']: [Uri];
    ['workbench.action.files.saveAs']: [Uri];
    ['workbench.action.files.save']: [Uri];
    ['notebook.selectKernel']:
        | [
              // This set of args will set the kernel/controller to the one with the id provided.
              | { id: string; extension: string }
              // This set of args will display the kernel picker.
              | { notebookEditor: NotebookEditor }
              // Open a specific notebook with a specific kernel.
              | { notebookEditor: NotebookEditor; id: string; extension: string }
          ]
        | [];
    ['undo']: [];
    ['interactive.open']: [
        { preserveFocus?: boolean; viewColumn?: ViewColumn },
        Uri | undefined,
        string | undefined,
        string | undefined
    ];
    ['interactive.execute']: [string];
    ['outline.focus']: [];
    ['vscode.executeCompletionItemProvider']: [Uri, Position];
    ['notebook.cell.collapseCellInput']: [
        { ranges: { start: number; end: number }[]; document?: Uri; autoReveal?: boolean }
    ];
    ['notebook.cell.expandCellInput']: [
        { ranges: { start: number; end: number }[]; document?: Uri; autoReveal?: boolean }
    ];
    [DSCommands.ExportFileAndOutputAsNotebook]: [Uri];
    [DSCommands.RunAllCells]: [Uri];
    [DSCommands.RunCell]: [Uri, number, number, number, number];
    [DSCommands.RunAllCellsAbove]: [Uri, number, number];
    [DSCommands.RunCellAndAllBelow]: [Uri, number, number];
    [DSCommands.RunAllCellsAbovePalette]: [];
    [DSCommands.RunCellAndAllBelowPalette]: [];
    [DSCommands.DebugCurrentCellPalette]: [];
    [DSCommands.RunToLine]: [Uri, number, number];
    [DSCommands.RunFromLine]: [Uri, number, number];
    [DSCommands.ImportNotebook]: [undefined | Uri, undefined | CommandSource];
    [DSCommands.ImportNotebookFile]: [undefined | Uri, undefined | CommandSource];
    [DSCommands.ExportFileAsNotebook]: [undefined | Uri, undefined | CommandSource];
    [DSCommands.ExecSelectionInInteractiveWindow]: [string | undefined];
    [DSCommands.RunFileInInteractiveWindows]: [Uri];
    [DSCommands.DebugFileInInteractiveWindows]: [Uri];
    [DSCommands.DebugCell]: [Uri, number, number, number, number];
    [DSCommands.DebugStepOver]: [Uri];
    [DSCommands.DebugStop]: [Uri];
    [DSCommands.DebugContinue]: [Uri];
    [DSCommands.RunCurrentCellAndAddBelow]: [Uri];
    [DSCommands.InsertCellBelowPosition]: [];
    [DSCommands.InsertCellBelow]: [];
    [DSCommands.InsertCellAbove]: [];
    [DSCommands.DeleteCells]: [];
    [DSCommands.SelectCell]: [];
    [DSCommands.SelectCellContents]: [];
    [DSCommands.ExtendSelectionByCellAbove]: [];
    [DSCommands.ExtendSelectionByCellBelow]: [];
    [DSCommands.MoveCellsUp]: [];
    [DSCommands.MoveCellsDown]: [];
    [DSCommands.ChangeCellToMarkdown]: [];
    [DSCommands.ChangeCellToCode]: [];
    [DSCommands.GotoNextCellInFile]: [];
    [DSCommands.GotoPrevCellInFile]: [];
    [DSCommands.ScrollToCell]: [Uri, string];
    [DSCommands.ViewJupyterOutput]: [];
    [DSCommands.ExportAsPythonScript]: [NotebookDocument | undefined, PythonEnvironment | undefined];
    [DSCommands.ExportToHTML]: [NotebookDocument | undefined, string | undefined, PythonEnvironment | undefined];
    [DSCommands.ExportToPDF]: [NotebookDocument | undefined, string | undefined, PythonEnvironment | undefined];
    [DSCommands.Export]: [NotebookDocument | undefined, string | undefined, PythonEnvironment | undefined];
    [DSCommands.NativeNotebookExport]: [Uri | undefined | { notebookEditor: { notebookUri: Uri } }];
    [DSCommands.LatestExtension]: [string];
    [DSCommands.EnableLoadingWidgetsFrom3rdPartySource]: [];
    [DSCommands.NotebookEditorExpandAllCells]: [];
    [DSCommands.NotebookEditorCollapseAllCells]: [];
    [DSCommands.ShowDataViewer]: [IShowDataViewerFromVariablePanel];
    [DSCommands.RefreshDataViewer]: [];
    [DSCommands.ClearSavedJupyterUris]: [];
    [DSCommands.SelectJupyterURI]: [
        boolean | undefined,
        Uri | SelectJupyterUriCommandSource | undefined,
        NotebookDocument | undefined
    ];
    [DSCommands.RunByLine]: [NotebookCell];
    [DSCommands.RunAndDebugCell]: [NotebookCell];
    [DSCommands.RunByLineNext]: [NotebookCell];
    [DSCommands.RunByLineStop]: [NotebookCell];
    [DSCommands.ReplayPylanceLog]: [Uri];
    [DSCommands.ReplayPylanceLogStep]: [];
    [DSCommands.InstallPythonExtensionViaKernelPicker]: [];
    [DSCommands.InstallPythonViaKernelPicker]: [];
}
