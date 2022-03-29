import { JupyterNotebookView } from '../../notebooks/constants';
import * as path from 'path';
import { EXTENSION_ROOT_DIR } from '../constants';

export const PYTHON_LANGUAGE = 'python';
export const MARKDOWN_LANGUAGE = 'markdown';
export const JUPYTER_LANGUAGE = 'jupyter';

export const NotebookCellScheme = 'vscode-notebook-cell';
export const PYTHON_UNTITLED = { scheme: 'untitled', language: PYTHON_LANGUAGE };
export const PYTHON_FILE = { scheme: 'file', language: PYTHON_LANGUAGE };
export const PYTHON_CELL = { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE };
export const PYTHON = [PYTHON_UNTITLED, PYTHON_FILE, PYTHON_CELL];
export const PYTHON_ALLFILES = [{ language: PYTHON_LANGUAGE }];
export const GITHUB_ISSUE_MARKDOWN_FILE = [{ language: MARKDOWN_LANGUAGE, scheme: 'untitled', pattern: '**/issue.md' }];

export const InteractiveInputScheme = 'vscode-interactive-input';
export const InteractiveScheme = 'vscode-interactive';

export const NOTEBOOK_SELECTOR = [
    { language: PYTHON_LANGUAGE, notebookType: JupyterNotebookView },
    { scheme: InteractiveInputScheme, language: PYTHON_LANGUAGE },
    { scheme: InteractiveScheme, language: PYTHON_LANGUAGE },
    { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE }
];

export const JVSC_EXTENSION_ID = 'ms-toolsai.jupyter';
export const JVSC_EXTENSION_DisplayName = 'Jupyter';
export const AppinsightsKey = 'AIF-d9b70cd4-b9f9-4d70-929b-a071c400b217';

export namespace Octicons {
    export const Downloading = '$(cloud-download)';
    export const Installing = '$(desktop-download)';
}

export namespace Text {
    export const CodeLensRunUnitTest = 'Run Test';
    export const CodeLensDebugUnitTest = 'Debug Test';
}
export namespace Delays {
    // Max time to wait before aborting the generation of code lenses for unit tests
    export const MaxUnitTestCodeLensDelay = 5000;
}

export const DEFAULT_INTERPRETER_SETTING = 'python';

export const STANDARD_OUTPUT_CHANNEL = 'STANDARD_OUTPUT_CHANNEL';

export const isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';

export function isTestExecution(): boolean {
    return process.env.VSC_JUPYTER_CI_TEST === '1' || isUnitTestExecution();
}

/**
 * Whether we're running unit tests (*.unit.test.ts).
 * These tests have a speacial meaning, they run fast.
 * @export
 * @returns {boolean}
 */
export function isUnitTestExecution(): boolean {
    return process.env.VSC_JUPYTER_UNIT_TEST === '1';
}

export * from '../constants';

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

export namespace DataFrameLoading {
    export const SysPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'vscode_datascience_helpers', 'dataframes');
    export const DataFrameSysImport = `import sys\nsys.path.append("${SysPath.replace(/\\/g, '\\\\')}")`;
    export const ScriptPath = path.join(SysPath, 'vscodeDataFrame.py');

    export const DataFrameInfoFunc = '_VSCODE_getDataFrameInfo';
    export const DataFrameRowFunc = '_VSCODE_getDataFrameRows';

    // Constants for the debugger which imports the script files
    export const DataFrameImport = `__import__('vscodeDataFrame')`;
    export const DataFrameInfoImportFunc = `${DataFrameImport}._VSCODE_getDataFrameInfo`;
    export const DataFrameRowImportFunc = `${DataFrameImport}._VSCODE_getDataFrameRows`;
}

export namespace GetVariableInfo {
    export const SysPath = path.join(
        EXTENSION_ROOT_DIR,
        'pythonFiles',
        'vscode_datascience_helpers',
        'getVariableInfo'
    );
    export const GetVariableInfoSysImport = `import sys\nsys.path.append("${SysPath.replace(/\\/g, '\\\\')}")`;
    export const ScriptPath = path.join(SysPath, 'vscodeGetVariableInfo.py');
    export const VariableInfoFunc = '_VSCODE_getVariableInfo';
    export const VariablePropertiesFunc = '_VSCODE_getVariableProperties';
    export const VariableTypesFunc = '_VSCODE_getVariableTypes';

    // Constants for the debugger which imports the script files
    export const VariableInfoImportName = `__import__('vscodeGetVariableInfo')`;
    export const VariableInfoImportFunc = `${VariableInfoImportName}._VSCODE_getVariableInfo`;
}

export namespace AddRunCellHook {
    export const SysPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'vscode_datascience_helpers', 'kernel');
    export const ScriptPath = path.join(SysPath, 'addRunCellHook.py');
}
