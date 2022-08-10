// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Terminal } from 'vscode';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../common/constants';
import { IPlatformService } from '../common/platform/types';
import { OSType } from '../common/utils/platform';
import { traceVerbose } from '../logging';
import { IShellDetector, ShellIdentificationTelemetry, TerminalShellType } from './types';

const defaultOSShells = {
    [OSType.Linux]: TerminalShellType.bash,
    [OSType.OSX]: TerminalShellType.bash,
    [OSType.Windows]: TerminalShellType.commandPrompt,
    [OSType.Unknown]: TerminalShellType.other
};

/**
 * Uses shellDetectors to identify the shell of the terminal.
 */
export class ShellDetector {
    constructor(private readonly platform: IPlatformService, private readonly shellDetectors: IShellDetector[]) {}
    /**
     * Logic is as follows:
     * 1. Try to identify the type of the shell based on the name of the terminal.
     * 2. Try to identify the type of the shell based on the settings in VSC.
     * 3. Try to identify the type of the shell based on the user environment (OS).
     * 4. If all else fail, use defaults hardcoded (cmd for windows, bash for linux & mac).
     * More information here: https://github.com/microsoft/vscode/issues/74233#issuecomment-497527337
     *
     * @param {Terminal} [terminal]
     * @returns {TerminalShellType}
     * @memberof TerminalHelper
     */
    public identifyTerminalShell(terminal: Terminal): TerminalShellType {
        let shell: TerminalShellType | undefined;
        const telemetryProperties: ShellIdentificationTelemetry = {
            failed: false,
            reason: undefined,
            shellIdentificationSource: 'default',
            terminalProvided: !!terminal,
            hasCustomShell: undefined,
            hasShellInEnv: undefined
        };

        // Sort in order of priority and then identify the shell.
        const shellDetectors = this.shellDetectors.slice().sort((a, b) => b.priority - a.priority);

        for (const detector of shellDetectors) {
            shell = detector.identify(telemetryProperties, terminal);
            traceVerbose(
                `${detector}. Shell identified as ${shell} ${terminal ? `(Terminal name is ${terminal.name})` : ''}`
            );
            if (shell && shell !== TerminalShellType.other) {
                telemetryProperties.failed = false;
                telemetryProperties.reason = 'unknownShell';
                break;
            }
        }

        // This information is useful in determining how well we identify shells on users machines.
        // This impacts executing code in terminals and activation of environments in terminal.
        // So, the better this works, the better it is for the user.
        sendTelemetryEvent(Telemetry.TerminalShellIdentification, undefined, telemetryProperties);
        traceVerbose(`Shell identified as '${shell}'`);

        // If we could not identify the shell, use the defaults.
        if (shell === undefined || shell === TerminalShellType.other) {
            traceVerbose('Using default OS shell');
            shell = defaultOSShells[this.platform.osType];
        }
        return shell;
    }
}
