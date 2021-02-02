// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { IJupyterExtraSettings } from '../../client/datascience/types';

export function getDefaultSettings(): IJupyterExtraSettings {
    // Default settings for tests
    // eslint-disable-next-line
    const result: Partial<IJupyterExtraSettings> = {
        insidersChannel: 'off',
        experiments: { enabled: true, optInto: [], optOutFrom: [] },
        logging: {
            level: 'off'
        },
        allowImportFromNotebook: true,
        alwaysTrustNotebooks: true,
        jupyterLaunchTimeout: 10,
        jupyterLaunchRetries: 3,
        jupyterServerType: 'local',
        // eslint-disable-next-line no-template-curly-in-string
        notebookFileRoot: '${fileDirname}',
        changeDirOnImportExport: false,
        useDefaultConfigForJupyter: true,
        jupyterInterruptTimeout: 10000,
        searchForJupyter: true,
        allowInput: true,
        showCellInputCode: true,
        collapseCellInputCodeByDefault: true,
        maxOutputSize: 400,
        enableScrollingForCellOutputs: true,
        errorBackgroundColor: '#FFFFFF',
        sendSelectionToInteractiveWindow: false,
        markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
        codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
        variableExplorerExclude: 'module;function;builtin_function_or_method',
        enablePlotViewer: true,
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
            useCustomEditorApi: false,
            hasPythonExtension: true
        },
        intellisenseOptions: {
            quickSuggestions: {
                other: true,
                comments: false,
                strings: false
            },
            acceptSuggestionOnEnter: 'on',
            quickSuggestionsDelay: 10,
            suggestOnTriggerCharacters: true,
            tabCompletion: 'on',
            suggestLocalityBonus: true,
            suggestSelection: 'recentlyUsed',
            wordBasedSuggestions: true,
            parameterHintsEnabled: true
        },
        runStartupCommands: '',
        debugJustMyCode: true,
        variableQueries: [],
        jupyterCommandLineArguments: [],
        widgetScriptSources: []
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function computeEditorOptions(settings: IJupyterExtraSettings): monacoEditor.editor.IEditorOptions {
    const intellisenseOptions = settings.intellisenseOptions;
    const extraSettings = settings.extraSettings;
    if (intellisenseOptions && extraSettings) {
        return {
            quickSuggestions: {
                other: intellisenseOptions.quickSuggestions.other,
                comments: intellisenseOptions.quickSuggestions.comments,
                strings: intellisenseOptions.quickSuggestions.strings
            },
            acceptSuggestionOnEnter: intellisenseOptions.acceptSuggestionOnEnter,
            quickSuggestionsDelay: intellisenseOptions.quickSuggestionsDelay,
            suggestOnTriggerCharacters: intellisenseOptions.suggestOnTriggerCharacters,
            tabCompletion: intellisenseOptions.tabCompletion,
            suggest: {
                localityBonus: intellisenseOptions.suggestLocalityBonus
            },
            suggestSelection: intellisenseOptions.suggestSelection,
            wordBasedSuggestions: intellisenseOptions.wordBasedSuggestions,
            parameterHints: {
                enabled: intellisenseOptions.parameterHintsEnabled
            },
            cursorStyle: extraSettings.editor.cursor,
            cursorBlinking: extraSettings.editor.cursorBlink,
            autoClosingBrackets: extraSettings.editor.autoClosingBrackets as any,
            autoClosingQuotes: extraSettings.editor.autoClosingQuotes as any,
            autoIndent: extraSettings.editor.autoIndent as any,
            autoSurround: extraSettings.editor.autoSurround as any,
            fontLigatures: extraSettings.editor.fontLigatures
        };
    }

    return {};
}
