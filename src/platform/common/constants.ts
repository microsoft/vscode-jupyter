export const PYTHON_LANGUAGE = 'python';
export const MARKDOWN_LANGUAGE = 'markdown';
export const JUPYTER_LANGUAGE = 'jupyter';

export const NotebookCellScheme = 'vscode-notebook-cell';
export const PYTHON_UNTITLED = { scheme: 'untitled', language: PYTHON_LANGUAGE };
export const PYTHON_FILE = { scheme: 'file', language: PYTHON_LANGUAGE };
export const PYTHON_FILE_ANY_SCHEME = { language: PYTHON_LANGUAGE };
export const PYTHON_CELL = { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE };
export const PYTHON = [PYTHON_UNTITLED, PYTHON_FILE, PYTHON_CELL];
export const PYTHON_ALLFILES = [{ language: PYTHON_LANGUAGE }];
export const GITHUB_ISSUE_MARKDOWN_FILE = [{ language: MARKDOWN_LANGUAGE, scheme: 'untitled', pattern: '**/issue.md' }];

export const InteractiveInputScheme = 'vscode-interactive-input';
export const InteractiveScheme = 'vscode-interactive';
export const JupyterNotebookView = 'jupyter-notebook';
export const InteractiveWindowView = 'interactive';

export const NOTEBOOK_SELECTOR = [
    { language: PYTHON_LANGUAGE, notebookType: JupyterNotebookView },
    { scheme: InteractiveInputScheme, language: PYTHON_LANGUAGE },
    { scheme: InteractiveScheme, language: PYTHON_LANGUAGE },
    { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE }
];

export const JVSC_EXTENSION_ID = 'ms-toolsai.jupyter';
export const AppinsightsKey = 'AIF-d9b70cd4-b9f9-4d70-929b-a071c400b217';

export const DEFAULT_INTERPRETER_SETTING = 'python';

export const STANDARD_OUTPUT_CHANNEL = 'STANDARD_OUTPUT_CHANNEL';

export * from '../constants';

/**
 * TODO@rebornix, move webviews/webview-side/common/constants to right places
 */
export * from '../../webviews/webview-side/common/constants';

export namespace HelpLinks {
    export const PythonInteractiveHelpLink = 'https://aka.ms/pyaiinstall';
    export const JupyterDataRateHelpLink = 'https://aka.ms/AA5ggm0'; // This redirects here: https://jupyter-notebook.readthedocs.io/en/stable/config.html
}

export namespace Settings {
    export const JupyterServerLocalLaunch = 'local';
    export const JupyterServerRemoteLaunch = 'remote';
    export const JupyterServerUriList = 'jupyter.jupyterServer.uriList';
    export const JupyterServerRemoteLaunchUriListKey = 'remote-uri-list';
    export const JupyterServerRemoteLaunchUriSeparator = '\r';
    export const JupyterServerRemoteLaunchNameSeparator = '\n';
    export const JupyterServerRemoteLaunchUriEqualsDisplayName = 'same';
    export const JupyterServerRemoteLaunchService = JVSC_EXTENSION_ID;
    export const JupyterServerUriListMax = 10;
    // If this timeout expires, ignore the completion request sent to Jupyter.
    export const IntellisenseTimeout = 2000;
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
    export const RawPurpose = 'raw';
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
}

export namespace CodeSnippets {
    export const ChangeDirectory = [
        '{0}',
        '{1}',
        'import os',
        'try:',
        "\tos.chdir(os.path.join(os.getcwd(), '{2}'))",
        '\tprint(os.getcwd())',
        'except:',
        '\tpass',
        ''
    ];
    export const ChangeDirectoryCommentIdentifier = '# ms-toolsai.jupyter added'; // Not translated so can compare.
    export const ImportIPython = '{0}\nfrom IPython import get_ipython\n\n{1}';
    export const MatplotLibInit = `import matplotlib\n%matplotlib inline\n${Identifiers.MatplotLibDefaultParams} = dict(matplotlib.rcParams)\n`;
    export const AppendSVGFigureFormat = `import matplotlib_inline.backend_inline\n${Identifiers.MatplotLibFigureFormats} = matplotlib_inline.backend_inline.InlineBackend.instance().figure_formats\n${Identifiers.MatplotLibFigureFormats}.add('svg')\nmatplotlib_inline.backend_inline.set_matplotlib_formats(*${Identifiers.MatplotLibFigureFormats})`;
    export const UpdateCWDAndPath =
        'import os\nimport sys\n%cd "{0}"\nif os.getcwd() not in sys.path:\n    sys.path.insert(0, os.getcwd())';
    export const DisableJedi = '%config Completer.use_jedi = False';
}

// Identifier for the output panel that will display the output from the Jupyter Server.
export const JUPYTER_OUTPUT_CHANNEL = 'JUPYTER_OUTPUT_CHANNEL';
export const KernelInterruptDaemonModule = 'vscode_datascience_helpers.kernel_interrupt_daemon';
export const JupyterDaemonModule = 'vscode_datascience_helpers.jupyter_daemon';
