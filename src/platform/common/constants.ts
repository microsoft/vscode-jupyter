// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const PYTHON_LANGUAGE = 'python';
export const MARKDOWN_LANGUAGE = 'markdown';
export const NotebookCellScheme = 'vscode-notebook-cell';
export const PYTHON_UNTITLED = { scheme: 'untitled', language: PYTHON_LANGUAGE };
export const PYTHON_FILE = { scheme: 'file', language: PYTHON_LANGUAGE };
export const PYTHON_FILE_ANY_SCHEME = { language: PYTHON_LANGUAGE };
export const PYTHON_CELL = { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE };
export const PYTHON = [PYTHON_UNTITLED, PYTHON_FILE, PYTHON_CELL];
export const InteractiveInputScheme = 'vscode-interactive-input';
export const JupyterNotebookView = 'jupyter-notebook';
export const InteractiveWindowView = 'interactive';

export const NOTEBOOK_SELECTOR = [
    { language: PYTHON_LANGUAGE, notebookType: JupyterNotebookView },
    { language: PYTHON_LANGUAGE, notebookType: InteractiveWindowView },
    { scheme: InteractiveInputScheme, language: PYTHON_LANGUAGE },
    { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE }
];

export const CodespaceExtensionId = 'GitHub.codespaces';
export const JVSC_EXTENSION_ID = 'ms-toolsai.jupyter';
export const JUPYTER_HUB_EXTENSION_ID = 'ms-toolsai.jupyter-hub';
export const AppinsightsKey = '0c6ae279ed8443289764825290e4f9e2-1a736e7c-1324-4338-be46-fc2a58ae4d14-7255';

export const STANDARD_OUTPUT_CHANNEL = 'STANDARD_OUTPUT_CHANNEL';

export * from '../constants';

export namespace HelpLinks {
    export const PythonInteractiveHelpLink = 'https://aka.ms/pyaiinstall';
    export const JupyterDataRateHelpLink = 'https://aka.ms/AA5ggm0'; // This redirects here: https://jupyter-notebook.readthedocs.io/en/stable/config.html
}

export namespace Settings {
    export const JupyterServerRemoteLaunchNameSeparator = '\n';
    export const JupyterServerRemoteLaunchService = JVSC_EXTENSION_ID;
    export const JupyterServerUriListMax = 10;
    // If this timeout expires, ignore the completion request sent to Jupyter.
    export const IntellisenseTimeout = 500;
    export const IntellisenseResolveTimeout = 2_000;
}

export let isCI = false;
export function setCI(enabled: boolean) {
    isCI = enabled;
}

let _isTestExecution = false;
export function isTestExecution(): boolean {
    return _isTestExecution || isUnitTestExecution();
}
export function setTestExecution(enabled: boolean) {
    _isTestExecution = enabled;
}

let _isUnitTestExecution = false;
/**
 * Whether we're running unit tests (*.unit.test.ts).
 * These tests have a speacial meaning, they run fast.
 * @export
 * @returns {boolean}
 */
export function isUnitTestExecution(): boolean {
    return _isUnitTestExecution;
}
export function setUnitTestExecution(enabled: boolean) {
    _isUnitTestExecution = enabled;
}

export namespace Identifiers {
    export const GeneratedThemeName = 'ipython-theme'; // This needs to be all lower class and a valid class name.
    export const MatplotLibDefaultParams = '_VSCode_defaultMatplotlib_Params';
    export const MatplotLibFigureFormats = '_VSCode_matplotLib_FigureFormats';
    export const DefaultCodeCellMarker = '# %%';
    export const DefaultCommTarget = 'jupyter.widget';
    export const ALL_VARIABLES = 'ALL_VARIABLES';
    export const KERNEL_VARIABLES = 'KERNEL_VARIABLES';
    export const DEBUGGER_VARIABLES = 'DEBUGGER_VARIABLES';
    export const PYTHON_VARIABLES_REQUESTER = 'PYTHON_VARIABLES_REQUESTER';
    export const MULTIPLEXING_DEBUGSERVICE = 'MULTIPLEXING_DEBUGSERVICE';
    export const RUN_BY_LINE_DEBUGSERVICE = 'RUN_BY_LINE_DEBUGSERVICE';
    export const REMOTE_URI = 'https://remote/';
    export const REMOTE_URI_ID_PARAM = 'id';
    export const REMOTE_URI_HANDLE_PARAM = 'uriHandle';
    export const REMOTE_URI_EXTENSION_ID_PARAM = 'extensionId';
}

export namespace CodeSnippets {
    export const ImportIPython = '{0}\nfrom IPython import get_ipython\n\n{1}';
    export const MatplotLibInit = `import matplotlib\n%matplotlib inline\n${Identifiers.MatplotLibDefaultParams} = dict(matplotlib.rcParams)\n`;
    export const UpdateCWDAndPath =
        'import os as _VSCODE_os\nimport sys as _VSCODE_sys\n%cd "{0}"\nif _VSCODE_os.getcwd() not in _VSCODE_sys.path:\n    _VSCODE_sys.path.insert(0, _VSCODE_os.getcwd())\n\ndel _VSCODE_sys\ndel _VSCODE_os';
    export const DisableJedi = '%config Completer.use_jedi = False';
}

// Identifier for the output panel that will display the output from the Jupyter Server.
export const JUPYTER_OUTPUT_CHANNEL = 'JUPYTER_OUTPUT_CHANNEL';

export const DefaultTheme = 'Default Light+';

// Python Module to be used when instantiating the Python Daemon.

export const PythonExtension = 'ms-python.python';
export const RendererExtension = 'ms-toolsai.jupyter-renderers';
export const PylanceExtension = 'ms-python.vscode-pylance';

export const LanguagesSupportedByPythonkernel = [
    'python',
    'html', // %%html
    'xml', // %%svg as svg is same as `xml`
    'javascript', // %%javascript, %%js
    'markdown', // %%markdown, %%latex
    'latex', // %%latex (some extensions register such languages)
    'shellscript', // %%script, %%bash, %%sh
    'bat', // %%script, %%bash, %%sh
    'powershell', // %%script powershell, %%script pwsh
    'kusto', // %%kqlmagic
    'ruby', // %%ruby
    'sql', // %%sql
    'perl', // %%perl
    'qsharp', // %%qsharp
    'raw' // raw cells (no formatting)
];
export const jupyterLanguageToMonacoLanguageMapping = new Map([
    ['bash', 'shellscript'],
    ['c#', 'csharp'],
    ['f#', 'fsharp'],
    ['q#', 'qsharp'],
    ['c++11', 'c++'],
    ['c++12', 'c++'],
    ['c++14', 'c++']
]);
/**
 * This will get updated with the list of VS Code languages.
 * This way, we can send those via telemetry, instead of having to hardcode the languages.
 */
export const VSCodeKnownNotebookLanguages: string[] = [
    'python',
    'r',
    'julia',
    'c++',
    'c#',
    'f#',
    'q#',
    'powershell',
    'java',
    'scala',
    'haskell',
    'bash',
    'cling',
    'rust',
    'sas',
    'sos',
    'ocaml'
];

export enum CommandSource {
    auto = 'auto',
    ui = 'ui',
    codelens = 'codelens',
    commandPalette = 'commandpalette'
}

export namespace Commands {
    export const RunAllCells = 'jupyter.runallcells';
    export const RunAllCellsAbove = 'jupyter.runallcellsabove';
    export const RunCellAndAllBelow = 'jupyter.runcellandallbelow';
    export const RunAllCellsAbovePalette = 'jupyter.runallcellsabove.palette';
    export const RunCellAndAllBelowPalette = 'jupyter.runcurrentcellandallbelow.palette';
    export const RunToLine = 'jupyter.runtoline';
    export const RunFromLine = 'jupyter.runfromline';
    export const RunCell = 'jupyter.runcell';
    export const RunCurrentCell = 'jupyter.runcurrentcell';
    export const RunCurrentCellAdvance = 'jupyter.runcurrentcelladvance';
    export const CreateNewInteractive = 'jupyter.createnewinteractive';
    export const ImportNotebook = 'jupyter.importnotebook';
    export const ImportNotebookFile = 'jupyter.importnotebookfile';
    export const ExportFileAsNotebook = 'jupyter.exportfileasnotebook';
    export const ExportFileAndOutputAsNotebook = 'jupyter.exportfileandoutputasnotebook';
    export const InterruptKernel = 'jupyter.interruptkernel';
    export const RestartKernel = 'jupyter.restartkernel';
    export const RestartKernelAndRunAllCells = 'jupyter.restartkernelandrunallcells';
    export const RestartKernelAndRunUpToSelectedCell = 'jupyter.restartkernelandrunuptoselectedcell';
    export const NotebookEditorRemoveAllCells = 'jupyter.notebookeditor.removeallcells';
    export const NotebookEditorRunAllCells = 'jupyter.notebookeditor.runallcells';
    export const NotebookEditorRunSelectedCell = 'jupyter.notebookeditor.runselectedcell';
    export const NotebookEditorAddCellBelow = 'jupyter.notebookeditor.addcellbelow';
    export const ExpandAllCells = 'jupyter.expandallcells';
    export const CollapseAllCells = 'jupyter.collapseallcells';
    export const ExportOutputAsNotebook = 'jupyter.exportoutputasnotebook';
    export const ExecSelectionInInteractiveWindow = 'jupyter.execSelectionInteractive';
    export const RunFileInInteractiveWindows = 'jupyter.runFileInteractive';
    export const DebugFileInInteractiveWindows = 'jupyter.debugFileInteractive';
    export const AddCellBelow = 'jupyter.addcellbelow';
    export const DebugCurrentCellPalette = 'jupyter.debugcurrentcell.palette';
    export const DebugCell = 'jupyter.debugcell';
    export const DebugStepOver = 'jupyter.debugstepover';
    export const DebugContinue = 'jupyter.debugcontinue';
    export const DebugStop = 'jupyter.debugstop';
    export const RunCurrentCellAndAddBelow = 'jupyter.runcurrentcellandaddbelow';
    export const InsertCellBelowPosition = 'jupyter.insertCellBelowPosition';
    export const InsertCellBelow = 'jupyter.insertCellBelow';
    export const InsertCellAbove = 'jupyter.insertCellAbove';
    export const DeleteCells = 'jupyter.deleteCells';
    export const SelectCell = 'jupyter.selectCell';
    export const SelectCellContents = 'jupyter.selectCellContents';
    export const ExtendSelectionByCellAbove = 'jupyter.extendSelectionByCellAbove';
    export const ExtendSelectionByCellBelow = 'jupyter.extendSelectionByCellBelow';
    export const MoveCellsUp = 'jupyter.moveCellsUp';
    export const MoveCellsDown = 'jupyter.moveCellsDown';
    export const ChangeCellToMarkdown = 'jupyter.changeCellToMarkdown';
    export const ChangeCellToCode = 'jupyter.changeCellToCode';
    export const GotoNextCellInFile = 'jupyter.gotoNextCellInFile';
    export const GotoPrevCellInFile = 'jupyter.gotoPrevCellInFile';
    export const ScrollToCell = 'jupyter.scrolltocell';
    export const CreateNewNotebook = 'jupyter.createnewnotebook';
    export const ViewJupyterOutput = 'jupyter.viewOutput';
    export const ExportAsPythonScript = 'jupyter.exportAsPythonScript';
    export const ExportToHTML = 'jupyter.exportToHTML';
    export const ExportToPDF = 'jupyter.exportToPDF';
    export const Export = 'jupyter.export';
    export const NativeNotebookExport = 'jupyter.notebookeditor.export';
    export const LatestExtension = 'jupyter.latestExtension';
    export const EnableLoadingWidgetsFrom3rdPartySource = 'jupyter.enableLoadingWidgetScriptsFromThirdPartySource';
    export const NotebookEditorExpandAllCells = 'jupyter.notebookeditor.expandallcells';
    export const NotebookEditorCollapseAllCells = 'jupyter.notebookeditor.collapseallcells';
    export const EnableDebugLogging = 'jupyter.enableDebugLogging';
    export const ResetLoggingLevel = 'jupyter.resetLoggingLevel';
    export const ShowDataViewer = 'jupyter.showDataViewer';
    export const RefreshDataViewer = 'jupyter.refreshDataViewer';
    export const ClearSavedJupyterUris = 'jupyter.clearSavedJupyterUris';
    export const OpenVariableView = 'jupyter.openVariableView';
    export const OpenOutlineView = 'jupyter.openOutlineView';
    export const InteractiveClearAll = 'jupyter.interactive.clearAllCells';
    export const InteractiveGoToCode = 'jupyter.interactive.goToCode';
    export const InteractiveCopyCell = 'jupyter.interactive.copyCell';
    export const InteractiveExportAsNotebook = 'jupyter.interactive.exportasnotebook';
    export const InteractiveExportAs = 'jupyter.interactive.exportas';
    export const RunByLine = 'jupyter.runByLine';
    export const RunAndDebugCell = 'jupyter.runAndDebugCell';
    export const RunByLineNext = 'jupyter.runByLineNext';
    export const RunByLineStop = 'jupyter.runByLineStop';
    export const ReplayPylanceLog = 'jupyter.replayPylanceLog';
    export const ReplayPylanceLogStep = 'jupyter.replayPylanceLogStep';
    export const InstallPythonExtensionViaKernelPicker = 'jupyter.installPythonExtensionViaKernelPicker';
    export const InstallPythonViaKernelPicker = 'jupyter.installPythonViaKernelPicker';
    export const ContinueEditSessionInCodespace = 'jupyter.continueEditSessionInCodespace';
}

export namespace CodeLensCommands {
    // If not specified in the options this is the default set of commands in our design time code lenses
    export const DefaultDesignLenses = [Commands.RunCurrentCell, Commands.RunAllCellsAbove, Commands.DebugCell];
    // If not specified in the options this is the default set of commands in our debug time code lenses
    export const DefaultDebuggingLenses = [Commands.DebugContinue, Commands.DebugStop, Commands.DebugStepOver];
    // These are the commands that are allowed at debug time
    export const DebuggerCommands = [Commands.DebugContinue, Commands.DebugStop, Commands.DebugStepOver];
}

export namespace EditorContexts {
    export const HasCodeCells = 'jupyter.hascodecells';
    export const IsInteractiveActive = 'jupyter.isinteractiveactive';
    export const OwnsSelection = 'jupyter.ownsSelection';
    export const HaveNativeCells = 'jupyter.havenativecells';
    export const HaveNative = 'jupyter.havenative';
    export const IsNativeActive = 'jupyter.isnativeactive';
    export const IsInteractiveOrNativeActive = 'jupyter.isinteractiveornativeactive';
    export const IsPythonOrNativeActive = 'jupyter.ispythonornativeactive';
    export const IsPythonOrInteractiveActive = 'jupyter.ispythonorinteractiveeactive';
    export const IsPythonOrInteractiveOrNativeActive = 'jupyter.ispythonorinteractiveornativeeactive';
    export const CanRestartNotebookKernel = 'jupyter.notebookeditor.canrestartNotebookkernel';
    export const CanInterruptNotebookKernel = 'jupyter.notebookeditor.canInterruptNotebookKernel';
    export const CanRestartInteractiveWindowKernel = 'jupyter.interactive.canRestartNotebookKernel';
    export const CanInterruptInteractiveWindowKernel = 'jupyter.interactive.canInterruptNotebookKernel';
    export const RunByLineCells = 'jupyter.notebookeditor.runByLineCells';
    export const RunByLineDocuments = 'jupyter.notebookeditor.runByLineDocuments';
    export const DebugDocuments = 'jupyter.notebookeditor.debugDocuments';
    export const IsPythonNotebook = 'jupyter.ispythonnotebook';
    export const IsJupyterKernelSelected = 'jupyter.kernel.isjupyter';
    export const IsDataViewerActive = 'jupyter.dataViewerActive';
    export const HasNativeNotebookOrInteractiveWindowOpen = 'jupyter.hasNativeNotebookOrInteractiveWindowOpen';
    export const ZmqAvailable = 'jupyter.zmqavailable';
    export const ReplayLogLoaded = 'jupyter.replayLogLoaded';
    export const KernelSource = 'jupyter.kernelSource';
}

export namespace RegExpValues {
    export const PythonCellMarker = /^(#\s*%%|#\s*\<codecell\>|#\s*In\[\d*?\]|#\s*In\[ \])/;
    export const PythonMarkdownCellMarker = /^(#\s*%%\s*\[markdown\]|#\s*\<markdowncell\>)/;
    export const UrlPatternRegEx =
        '(?<PREFIX>https?:\\/\\/)((\\(.+\\s+or\\s+(?<IP>.+)\\))|(?<LOCAL>[^\\s]+))(?<REST>:.+)';
    export const HttpPattern = /https?:\/\//;
    export const ShapeSplitterRegEx = /.*,\s*(\d+).*/;
    export const SvgHeightRegex = /(\<svg.*height=\")(.*?)\"/;
    export const SvgWidthRegex = /(\<svg.*width=\")(.*?)\"/;
    export const SvgSizeTagRegex = /\<svg.*tag=\"sizeTag=\{(.*),\s*(.*)\}\"/;
}

export enum Telemetry {
    ImportNotebook = 'DATASCIENCE.IMPORT_NOTEBOOK',
    RunCurrentCell = 'DATASCIENCE.RUN_CURRENT_CELL',
    RunCurrentCellAndAdvance = 'DATASCIENCE.RUN_CURRENT_CELL_AND_ADVANCE',
    RunAllCells = 'DATASCIENCE.RUN_ALL_CELLS',
    RunAllCellsAbove = 'DATASCIENCE.RUN_ALL_CELLS_ABOVE',
    RunCellAndAllBelow = 'DATASCIENCE.RUN_CELL_AND_ALL_BELOW',
    RunCurrentCellAndAddBelow = 'DATASCIENCE.RUN_CURRENT_CELL_AND_ADD_BELOW',
    InsertCellBelowPosition = 'DATASCIENCE.RUN_INSERT_CELL_BELOW_POSITION',
    InsertCellBelow = 'DATASCIENCE.RUN_INSERT_CELL_BELOW',
    InsertCellAbove = 'DATASCIENCE.RUN_INSERT_CELL_ABOVE',
    DeleteCells = 'DATASCIENCE.RUN_DELETE_CELLS',
    SelectCell = 'DATASCIENCE.RUN_SELECT_CELL',
    SelectCellContents = 'DATASCIENCE.RUN_SELECT_CELL_CONTENTS',
    ExtendSelectionByCellAbove = 'DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_ABOVE',
    ExtendSelectionByCellBelow = 'DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_BELOW',
    MoveCellsUp = 'DATASCIENCE.RUN_MOVE_CELLS_UP',
    MoveCellsDown = 'DATASCIENCE.RUN_MOVE_CELLS_DOWN',
    ChangeCellToMarkdown = 'DATASCIENCE.RUN_CHANGE_CELL_TO_MARKDOWN',
    ChangeCellToCode = 'DATASCIENCE.RUN_CHANGE_CELL_TO_CODE',
    GotoNextCellInFile = 'DATASCIENCE.GOTO_NEXT_CELL_IN_FILE',
    GotoPrevCellInFile = 'DATASCIENCE.GOTO_PREV_CELL_IN_FILE',
    RunSelectionOrLine = 'DATASCIENCE.RUN_SELECTION_OR_LINE',
    RunToLine = 'DATASCIENCE.RUN_TO_LINE',
    RunFromLine = 'DATASCIENCE.RUN_FROM_LINE',
    /**
     * Exporting from the interactive window
     */
    ExportPythonFileInteractive = 'DATASCIENCE.EXPORT_PYTHON_FILE',
    ExportPythonFileAndOutputInteractive = 'DATASCIENCE.EXPORT_PYTHON_FILE_AND_OUTPUT',
    /**
     * User clicked export as quick pick button
     */
    ClickedExportNotebookAsQuickPick = 'DATASCIENCE.CLICKED_EXPORT_NOTEBOOK_AS_QUICK_PICK',
    /**
     * exported a notebook
     */
    ExportNotebookAs = 'DATASCIENCE.EXPORT_NOTEBOOK_AS',
    /**
     * User invokes export as format from command pallet
     */
    ExportNotebookAsCommand = 'DATASCIENCE.EXPORT_NOTEBOOK_AS_COMMAND',
    /**
     * An export to a specific format failed
     */
    ExportNotebookAsFailed = 'DATASCIENCE.EXPORT_NOTEBOOK_AS_FAILED',
    StartedRemoteJupyterSessionWithBackingFile = 'DS_INTERNAL.JUPYTER_STARTED_SESSION_WITH_BACKING_FILE',
    ZMQSupport = 'DS_INTERNAL.JUPYTER_ZMQ_SUPPORT',
    ZMQSupportFailure = 'DS_INTERNAL.JUPYTER_ZMQ_SUPPORT_FAILURE',
    SelfCertsMessageEnabled = 'DATASCIENCE.SELFCERTSMESSAGEENABLED',
    SelfCertsMessageClose = 'DATASCIENCE.SELFCERTSMESSAGECLOSE',
    ShiftEnterBannerShown = 'DS_INTERNAL.SHIFTENTER_BANNER_SHOWN',
    EnableInteractiveShiftEnter = 'DATASCIENCE.ENABLE_INTERACTIVE_SHIFT_ENTER',
    DisableInteractiveShiftEnter = 'DATASCIENCE.DISABLE_INTERACTIVE_SHIFT_ENTER',
    StartShowDataViewer = 'DATASCIENCE.START_SHOW_DATA_EXPLORER', // Called by the factory when attempting to load the data viewer
    ShowDataViewer = 'DATASCIENCE.SHOW_DATA_EXPLORER', // Called by the data viewer itself when it is actually loaded
    ShowDataViewerRowsLoaded = 'DATASCIENCE.SHOW_DATA_EXPLORER_ROWS_LOADED',
    FailedShowDataViewer = 'DATASCIENCE.FAILED_SHOW_DATA_EXPLORER', // Called by the factory when the data viewer fails to load
    RefreshDataViewer = 'DATASCIENCE.REFRESH_DATA_VIEWER',
    RunFileInteractive = 'DATASCIENCE.RUN_FILE_INTERACTIVE',
    DebugFileInteractive = 'DATASCIENCE.DEBUG_FILE_INTERACTIVE',
    PandasNotInstalled = 'DS_INTERNAL.SHOW_DATA_NO_PANDAS',
    PandasTooOld = 'DS_INTERNAL.SHOW_DATA_PANDAS_TOO_OLD',
    PandasOK = 'DS_INTERNAL.SHOW_DATA_PANDAS_OK',
    PandasInstallCanceled = 'DS_INTERNAL.SHOW_DATA_PANDAS_INSTALL_CANCELED',
    DataScienceSettings = 'DS_INTERNAL.SETTINGS',
    VariableExplorerVariableCount = 'DS_INTERNAL.VARIABLE_EXPLORER_VARIABLE_COUNT',
    AddCellBelow = 'DATASCIENCE.ADD_CELL_BELOW',
    GetPasswordFailure = 'DS_INTERNAL.GET_PASSWORD_FAILURE',
    GetPasswordSuccess = 'DS_INTERNAL.GET_PASSWORD_SUCCESS',
    CheckPasswordJupyterHub = 'DS_INTERNAL.JUPYTER_HUB_PASSWORD',
    OpenPlotViewer = 'DATASCIENCE.OPEN_PLOT_VIEWER',
    DebugCurrentCell = 'DATASCIENCE.DEBUG_CURRENT_CELL',
    CodeLensAverageAcquisitionTime = 'DS_INTERNAL.CODE_LENS_ACQ_TIME',
    DocumentWithCodeCells = 'DS_INTERNAL.DOCUMENT_WITH_CODE_CELLS',
    PerceivedJupyterStartupNotebook = 'DS_INTERNAL.PERCEIVED_JUPYTER_STARTUP_NOTEBOOK',
    GetActivatedEnvironmentVariables = 'DS_INTERNAL.GET_ACTIVATED_ENV_VARIABLES',
    VariableExplorerFetchTime = 'DS_INTERNAL.VARIABLE_EXPLORER_FETCH_TIME',
    KernelSpec = 'DS_INTERNAL.JUPYTER_KERNEL_SPEC',
    CellOutputMimeType = 'DS_INTERNAL.CELL_OUTPUT_MIME_TYPE',
    JupyterApiUsage = 'DATASCIENCE.JUPYTER_API_USAGE',
    KernelCodeCompletion = 'DATASCIENCE.JUPYTER_KERNEL_CODE_COMPLETION',
    KernelCodeCompletionCannotResolve = 'DATASCIENCE.JUPYTER_KERNEL_CODE_COMPLETION_CANNOT_RESOLVE',
    JupyterKernelApiUsage = 'DATASCIENCE.JUPYTER_KERNEL_API_USAGE',
    NewJupyterKernelApiUsage = 'DATASCIENCE.JUPYTER_NEW_KERNEL_API_USAGE',
    NewJupyterKernelsApiUsage = 'DATASCIENCE.JUPYTER_NEW_KERNELS_API_USAGE',
    NewJupyterKernelApiExecution = 'DATASCIENCE.JUPYTER_NEW_KERNEL_API_EXEC',
    JupyterKernelApiAccess = 'DATASCIENCE.JUPYTER_KERNEL_API_ACCESS',
    JupyterKernelStartupHook = 'DATASCIENCE.JUPYTER_KERNEL_STARTUP_HOOK',
    JupyterKernelSpecEnumeration = 'DATASCIENCE.JUPYTER_KERNEL_SPEC_FETCH_FAILURE',
    JupyterKernelHiddenViaFilter = 'DATASCIENCE.JUPYTER_KERNEL_HIDDEN_VIA_FILTER',
    JupyterKernelFilterUsed = 'DATASCIENCE.JUPYTER_KERNEL_FILTER_USED',
    DebugStepOver = 'DATASCIENCE.DEBUG_STEP_OVER',
    DebugContinue = 'DATASCIENCE.DEBUG_CONTINUE',
    DebugStop = 'DATASCIENCE.DEBUG_STOP',
    OpenNotebookAll = 'DATASCIENCE.NATIVE.OPEN_NOTEBOOK_ALL',
    UserInstalledJupyter = 'DATASCIENCE.USER_INSTALLED_JUPYTER',
    UserInstalledPandas = 'DATASCIENCE.USER_INSTALLED_PANDAS',
    UserDidNotInstallJupyter = 'DATASCIENCE.USER_DID_NOT_INSTALL_JUPYTER',
    UserDidNotInstallPandas = 'DATASCIENCE.USER_DID_NOT_INSTALL_PANDAS',
    KernelSpecLanguage = 'DATASCIENCE.KERNEL_SPEC_LANGUAGE',
    KernelLauncherPerf = 'DS_INTERNAL.KERNEL_LAUNCHER_PERF',
    AmbiguousGlobalKernelSpec = 'GLOBAL_PYTHON_KERNELSPEC',
    ActiveInterpreterListingPerf = 'DS_INTERNAL.ACTIVE_INTERPRETER_LISTING_PERF',
    ExperimentLoad = 'DS_INTERNAL.EXPERIMENT_LOAD',
    PythonModuleInstall = 'DS_INTERNAL.PYTHON_MODULE_INSTALL',
    PythonNotInstalled = 'DS_INTERNAL.PYTHON_NOT_INSTALLED',
    PythonExtensionNotInstalled = 'DS_INTERNAL.PYTHON_EXTENSION_NOT_INSTALLED',
    PythonExtensionInstalledViaKernelPicker = 'DS_INTERNAL.PYTHON_EXTENSION_INSTALLED_VIA_KERNEL_PICKER',
    NewFileForInteractiveWindow = 'DS_INTERNAL.NEW_FILE_USED_IN_INTERACTIVE',
    CreateInteractiveWindow = 'DS_INTERNAL.CREATED_INTERACTIVE_WINDOW',
    IPyWidgetLoadSuccess = 'DS_INTERNAL.IPYWIDGET_LOAD_SUCCESS',
    IPyWidgetLoadFailure = 'DS_INTERNAL.IPYWIDGET_LOAD_FAILURE',
    IPyWidgetWidgetVersionNotSupportedLoadFailure = 'DS_INTERNAL.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED_LOAD_FAILURE',
    IPyWidgetExtensionJsInfo = 'DS_INTERNAL.IPYWIDGET_EXTENSIONJS_INFO',
    IPyWidgetNbExtensionCopyTime = 'DS_INTERNAL.IPYWIDGET_TIME_TO_COPY_NBEXTENSIONS_DIR',
    HashedIPyWidgetNameUsed = 'DS_INTERNAL.IPYWIDGET_USED_BY_USER',
    VSCNotebookCellTranslationFailed = 'DS_INTERNAL.VSCNOTEBOOK_CELL_TRANSLATION_FAILED',
    HashedIPyWidgetScriptDiscoveryError = 'DS_INTERNAL.IPYWIDGET_DISCOVERY_ERRORED',
    DiscoverIPyWidgetNamesPerf = 'DS_INTERNAL.IPYWIDGET_DISCOVER_WIDGETS_NB_EXTENSIONS',
    IPyWidgetPromptToUseCDN = 'DS_INTERNAL.IPYWIDGET_PROMPT_TO_USE_CDN',
    IPyWidgetPromptToUseCDNSelection = 'DS_INTERNAL.IPYWIDGET_PROMPT_TO_USE_CDN_SELECTION',
    IPyWidgetOverhead = 'DS_INTERNAL.IPYWIDGET_OVERHEAD',
    IPyWidgetRenderFailure = 'DS_INTERNAL.IPYWIDGET_RENDER_FAILURE',
    IPyWidgetUnhandledMessage = 'DS_INTERNAL.IPYWIDGET_UNHANDLED_MESSAGE',
    RawKernelInfoResponse = 'DS_INTERNAL.RAWKERNEL_INFO_RESPONSE',
    RawKernelSessionStartNoIpykernel = 'DS_INTERNAL.RAWKERNEL_SESSION_NO_IPYKERNEL',
    RawKernelProcessLaunch = 'DS_INTERNAL.RAWKERNEL_PROCESS_LAUNCH',
    RawKernelSessionShutdown = 'DS_INTERNAL.RAWKERNEL_SESSION_SHUTDOWN',
    RawKernelSessionKernelProcessExited = 'DS_INTERNAL.RAWKERNEL_SESSION_KERNEL_PROCESS_EXITED',
    RawKernelSessionDisposed = 'DS_INTERNAL.RAWKERNEL_SESSION_DISPOSED',
    RunByLineVariableHover = 'DATASCIENCE.RUN_BY_LINE_VARIABLE_HOVER',
    InteractiveFileTooltipsPerf = 'DS_INTERNAL.INTERACTIVE_FILE_TOOLTIPS_PERF',
    NativeVariableViewLoaded = 'DS_INTERNAL.NATIVE_VARIABLE_VIEW_LOADED',
    NativeVariableViewMadeVisible = 'DS_INTERNAL.NATIVE_VARIABLE_VIEW_MADE_VISIBLE',
    NotebookStart = 'DATASCIENCE.NOTEBOOK_START',
    KernelStartFailureDueToMissingEnv = 'DATASCIENCE.KERNEL_START_FAILURE_MISSING_ENV',
    NotebookInterrupt = 'DATASCIENCE.NOTEBOOK_INTERRUPT',
    NotebookRestart = 'DATASCIENCE.NOTEBOOK_RESTART',
    SwitchKernel = 'DS_INTERNAL.SWITCH_KERNEL',
    KernelCount = 'DS_INTERNAL.KERNEL_COUNT',
    ExecuteCell = 'DATASCIENCE.EXECUTE_CELL',
    ExecuteCode = 'DATASCIENCE.EXECUTE_CODE',
    ResumeCellExecution = 'DATASCIENCE.RESUME_EXECUTE_CELL',
    /**
     * Sent when a command we register is executed.
     */
    CommandExecuted = 'DS_INTERNAL.COMMAND_EXECUTED',
    /**
     * Telemetry event sent whenever the user toggles the checkbox
     * controlling whether a slice is currently being applied to an
     * n-dimensional variable.
     */
    DataViewerSliceEnablementStateChanged = 'DATASCIENCE.DATA_VIEWER_SLICE_ENABLEMENT_STATE_CHANGED',
    /**
     * Telemetry event sent when a slice is first applied in a
     * data viewer instance to a sliceable Python variable.
     */
    DataViewerDataDimensionality = 'DATASCIENCE.DATA_VIEWER_DATA_DIMENSIONALITY',
    /**
     * Telemetry event sent whenever the user applies a valid slice
     * to a sliceable Python variable in the data viewer.
     */
    DataViewerSliceOperation = 'DATASCIENCE.DATA_VIEWER_SLICE_OPERATION',
    RecommendExtension = 'DATASCIENCE.RECOMMENT_EXTENSION',
    CreatePythonEnvironment = 'DATASCIENCE.CREATE_PYTHON_ENVIRONMENT',
    // Sent when we get a jupyter execute_request error reply when running some part of our internal variable fetching code
    PythonVariableFetchingCodeFailure = 'DATASCIENCE.PYTHON_VARIABLE_FETCHING_CODE_FAILURE',
    // Sent when we get a jupyter execute_request error reply when running some part of interactive window debug setup code
    InteractiveWindowDebugSetupCodeFailure = 'DATASCIENCE.INTERACTIVE_WINDOW_DEBUG_SETUP_CODE_FAILURE',
    KernelCrash = 'DATASCIENCE.KERNEL_CRASH',
    RunTest = 'DS_INTERNAL.RUNTEST',
    PreferredKernelExactMatch = 'DS_INTERNAL.PREFERRED_KERNEL_EXACT_MATCH',
    NoActiveKernelSession = 'DATASCIENCE.NO_ACTIVE_KERNEL_SESSION',
    DataViewerUsingInterpreter = 'DATAVIEWER.USING_INTERPRETER',
    DataViewerUsingKernel = 'DATAVIEWER.USING_KERNEL',
    DataViewerWebviewLoaded = 'DATAVIEWER.WEBVIEW_LOADED',
    PlotViewerWebviewLoaded = 'PLOTVIEWER.WEBVIEW_LOADED',
    EnterRemoteJupyterUrl = 'DATASCIENCE.ENTER_REMOTE_JUPYTER_URL'
}

export enum JupyterCommands {
    NotebookCommand = 'notebook',
    ConvertCommand = 'nbconvert',
    KernelSpecCommand = 'kernelspec'
}

export const DataScienceStartupTime = Symbol('DataScienceStartupTime');

// Default for notebook version (major & minor) used when creating notebooks.
export const defaultNotebookFormat = { major: 4, minor: 2 };

export const WIDGET_MIMETYPE = 'application/vnd.jupyter.widget-view+json';
export const WIDGET_STATE_MIMETYPE = 'application/vnd.jupyter.widget-state+json';
export const WIDGET_VERSION_NON_PYTHON_KERNELS = 7;

/**
 * Used as a fallback when determinining the extension id that calls into the Jupyter extension API fails.
 */
export const unknownExtensionId = 'unknown';
