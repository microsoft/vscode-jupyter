// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Terminal, TextEditor, Uri } from 'vscode';
import { IEventNamePropertyMapping } from '../../telemetry';
import { Resource } from '../common/types';

export const ICodeExecutionService = Symbol('ICodeExecutionService');

export interface ICodeExecutionService {
    execute(code: string, resource?: Uri): Promise<void>;
    executeFile(file: Uri): Promise<void>;
    initializeRepl(resource?: Uri): Promise<void>;
}

export const ICodeExecutionHelper = Symbol('ICodeExecutionHelper');

export interface ICodeExecutionHelper {
    normalizeLines(code: string): Promise<string>;
    getFileToExecute(): Promise<Uri | undefined>;
    saveFileIfDirty(file: Uri): Promise<void>;
    getSelectedTextToExecute(textEditor: TextEditor): string | undefined;
}

export enum TerminalShellType {
    powershell = 'powershell',
    powershellCore = 'powershellCore',
    commandPrompt = 'commandPrompt',
    gitbash = 'gitbash',
    bash = 'bash',
    zsh = 'zsh',
    ksh = 'ksh',
    fish = 'fish',
    cshell = 'cshell',
    tcshell = 'tshell',
    wsl = 'wsl',
    xonsh = 'xonsh',
    other = 'other'
}
export const ITerminalHelper = Symbol('ITerminalHelper');

export interface ITerminalHelper {
    getEnvironmentVariables(resource: Resource): Promise<{ env?: NodeJS.ProcessEnv; shell: TerminalShellType }>;
}

export type ShellIdentificationTelemetry = IEventNamePropertyMapping['TERMINAL_SHELL_IDENTIFICATION'];

export const IShellDetector = Symbol('IShellDetector');
/**
 * Used to identify a shell.
 * Each implementation will provide a unique way of identifying the shell.
 */
export interface IShellDetector {
    /**
     * Classes with higher priorities will be used first when identifying the shell.
     */
    readonly priority: number;
    identify(telemetryProperties: ShellIdentificationTelemetry, terminal: Terminal): TerminalShellType | undefined;
}
