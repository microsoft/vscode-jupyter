// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { PYTHON_LANGUAGE } from '../../client/common/constants';
import { Identifiers } from '../../client/datascience/constants';
import { CellState, ICell, IExternalWebviewCellButton, IJupyterExtraSettings } from '../../client/datascience/types';
import { createCodeCell } from '../common/cellFactory';
import { getDefaultSettings } from '../react-common/settingsReactSide';

export enum CursorPos {
    Top,
    Bottom,
    Current
}

// The state we are in for run by line debugging
export enum DebugState {
    Break,
    Design,
    Run
}

export function activeDebugState(state: DebugState): boolean {
    return state === DebugState.Break || state === DebugState.Run;
}

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
    kernel: IServerState;
    externalButtons: IExternalWebviewCellButton[];
};

export type SelectionAndFocusedInfo = {
    selectedCellId?: string;
    selectedCellIndex?: number;
    focusedCellId?: string;
    focusedCellIndex?: number;
};

export interface IFont {
    size: number;
    family: string;
}

export interface IServerState {
    jupyterServerStatus: ServerStatus;
    serverName: string;
    kernelName: string;
    language: string;
}

export enum ServerStatus {
    NotStarted = 'Not Started',
    Busy = 'Busy',
    Idle = 'Idle',
    Dead = 'Dead',
    Starting = 'Starting',
    Restarting = 'Restarting'
}

// eslint-disable-next-line no-multi-str
const darkStyle = `
        :root {
            --code-comment-color: #6A9955;
            --code-numeric-color: #b5cea8;
            --code-string-color: #ce9178;
            --code-variable-color: #9CDCFE;
            --code-type-color: #4EC9B0;
            --code-font-family: Consolas, 'Courier New', monospace;
            --code-font-size: 14px;
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
        testMode: true,
        kernel: {
            serverName: '',
            kernelName: 'Python',
            jupyterServerStatus: ServerStatus.NotStarted,
            language: PYTHON_LANGUAGE
        },
        externalButtons: []
    };
}

export function createEmptyCell(id: string | undefined, executionCount: number | null): ICell {
    const emptyCodeCell = createCodeCell();
    emptyCodeCell.execution_count = executionCount ?? null;
    return {
        data: emptyCodeCell,
        id: id ? id : Identifiers.EditCellId,
        file: Identifiers.EmptyFileName,
        line: 0,
        state: CellState.finished
    };
}
