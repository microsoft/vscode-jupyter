// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { IJupyterExtraSettings } from '../../../platform/webviews/types';
import { getDefaultSettings } from '../react-common/settingsReactSide';

export type IMainState = {
    busy: boolean;
    skipNextScroll?: boolean;
    submittedText: boolean;
    rootStyle?: string;
    rootCss?: string;
    font: IFont;
    vscodeThemeName?: string;
    baseTheme: string;
    knownDark: boolean;
    currentExecutionCount: number;
    debugging: boolean;
    dirty: boolean;
    isAtBottom: boolean;
    loadTotal?: number;
    skipDefault?: boolean;
    testMode?: boolean;
    codeTheme: string;
    settings?: IJupyterExtraSettings;
    focusPending: number;
    loaded: boolean;
};

export interface IFont {
    size: number;
    family: string;
}

// eslint-disable-next-line no-multi-str
const darkStyle = `
        :root {
            --code-comment-color: #6A9955;
            --code-numeric-color: #b5cea8;
            --code-string-color: #ce9178;
            --code-variable-color: #9CDCFE;
            --code-type-color: #4EC9B0;
        }
`;

// This function generates test state when running under a browser instead of inside of
export function generateTestState(_filePath: string = '', _editable: boolean = false): IMainState {
    const defaultSettings = getDefaultSettings();

    return {
        busy: false,
        skipNextScroll: false,
        submittedText: false,
        rootStyle: darkStyle,
        currentExecutionCount: 0,
        knownDark: false,
        baseTheme: 'vscode-light',
        debugging: false,
        isAtBottom: false,
        font: {
            size: 14,
            family: "Consolas, 'Courier New', monospace"
        },
        dirty: false,
        codeTheme: 'Foo',
        settings: defaultSettings,
        focusPending: 0,
        loaded: false,
        testMode: true
    };
}
