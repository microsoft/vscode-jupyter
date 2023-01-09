// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IJupyterExtraSettings } from '../../../platform/webviews/types';

export function getDefaultSettings(): IJupyterExtraSettings {
    // Default settings for tests
    // eslint-disable-next-line
    const result: Partial<IJupyterExtraSettings> = {
        experiments: { enabled: true, optInto: [], optOutFrom: [] },
        logging: {
            level: 'off'
        },
        allowImportFromNotebook: true,
        jupyterLaunchTimeout: 10,
        jupyterLaunchRetries: 3,
        // eslint-disable-next-line no-template-curly-in-string
        notebookFileRoot: '${fileDirname}',
        useDefaultConfigForJupyter: true,
        jupyterInterruptTimeout: 10000,
        searchForJupyter: true,
        showCellInputCode: true,
        enableScrollingForCellOutputs: true,
        errorBackgroundColor: '#FFFFFF',
        sendSelectionToInteractiveWindow: false,
        markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
        codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
        variableExplorerExclude: 'module;function;builtin_function_or_method',
        generateSVGPlots: false,
        interactiveWindowMode: 'multiple',
        extraSettings: {
            editor: {
                cursor: 'line',
                cursorBlink: 'blink',
                autoClosingBrackets: 'languageDefined',
                autoClosingQuotes: 'languageDefined',
                autoSurround: 'languageDefined',
                autoIndent: false,
                fontLigatures: false,
                scrollBeyondLastLine: true,
                // VS Code puts a value for this, but it's 10 (the explorer bar size) not 14 the editor size for vert
                verticalScrollbarSize: 14,
                horizontalScrollbarSize: 14,
                fontSize: 14,
                fontFamily: "Consolas, 'Courier New', monospace"
            },
            theme: 'Default Dark+',
            hasPythonExtension: true,
            isWeb: false
        },
        runStartupCommands: '',
        debugJustMyCode: true,
        variableQueries: [],
        widgetScriptSources: []
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
}
