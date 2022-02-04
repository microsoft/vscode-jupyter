// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { EXTENSION_ROOT_DIR, JVSC_EXTENSION_ID } from '../common/constants';
import * as path from 'path';

export * from '../../datascience-ui/common/constants';

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
