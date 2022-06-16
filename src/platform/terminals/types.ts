// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Terminal, TextEditor, Uri } from 'vscode';
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

/*
 * Telemetry event sent to provide information on whether we have successfully identify the type of shell used.
 * This information is useful in determining how well we identify shells on users machines.
 * This impacts extraction of env variables from current shell.
 * So, the better this works, the better it is for the user.
 * failed - If true, indicates we have failed to identify the shell. Note this impacts impacts ability to activate environments in the terminal & code.
 * shellIdentificationSource - How was the shell identified. One of 'terminalName' | 'settings' | 'environment' | 'default'
 *                             If terminalName, then this means we identified the type of the shell based on the name of the terminal.
 *                             If settings, then this means we identified the type of the shell based on user settings in VS Code.
 *                             If environment, then this means we identified the type of the shell based on their environment (env variables, etc).
 *                                 I.e. their default OS Shell.
 *                             If default, then we reverted to OS defaults (cmd on windows, and bash on the rest).
 *                                 This is the worst case scenario.
 *                                 I.e. we could not identify the shell at all.
 * hasCustomShell - If undefined (not set), we didn't check.
 *                  If true, user has customzied their shell in VSC Settings.
 * hasShellInEnv - If undefined (not set), we didn't check.
 *                 If true, user has a shell in their environment.
 *                 If false, user does not have a shell in their environment.
 */
export interface ShellIdentificationTelemetry {
    failed: boolean;
    reason: 'unknownShell' | undefined;
    terminalProvided: boolean;
    shellIdentificationSource: 'terminalName' | 'settings' | 'environment' | 'default' | 'vscode';
    hasCustomShell: undefined | boolean;
    hasShellInEnv: undefined | boolean;
}

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
