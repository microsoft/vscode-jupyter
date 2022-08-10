// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Terminal } from 'vscode';
import { IPlatformService } from '../../common/platform/types';
import { OSType } from '../../common/utils/platform';
import { traceVerbose } from '../../logging';
import { ShellIdentificationTelemetry, TerminalShellType } from '../types';
import { BaseShellDetector } from './baseShellDetector.node';

/**
 * Identifies the shell based on the users environment (env variables).
 *
 * @export
 * @class UserEnvironmentShellDetector
 * @extends {BaseShellDetector}
 */
@injectable()
export class UserEnvironmentShellDetector extends BaseShellDetector {
    constructor(@inject(IPlatformService) private readonly platform: IPlatformService) {
        super(1);
    }
    public getDefaultPlatformShell(): string {
        return getDefaultShell(this.platform);
    }
    public identify(
        telemetryProperties: ShellIdentificationTelemetry,
        _terminal?: Terminal
    ): TerminalShellType | undefined {
        const shellPath = this.getDefaultPlatformShell();
        telemetryProperties.hasShellInEnv = !!shellPath;
        const shell = this.identifyShellFromShellPath(shellPath);

        if (shell !== TerminalShellType.other) {
            telemetryProperties.shellIdentificationSource = 'environment';
        }
        traceVerbose(`Shell path from user env '${shellPath}'`);
        return shell;
    }
}

/*
 The following code is based on VS Code from https://github.com/microsoft/vscode/blob/5c65d9bfa4c56538150d7f3066318e0db2c6151f/src/vs/workbench/contrib/terminal/node/terminal.ts#L12-L55
 This is only a fall back to identify the default shell used by VSC.
 On Windows, determine the default shell.
 On others, default to bash.
*/
function getDefaultShell(platform: IPlatformService): string {
    if (platform.osType === OSType.Windows) {
        return getTerminalDefaultShellWindows(platform);
    }

    return process.env.SHELL && process.env.SHELL !== '/bin/false' ? process.env.SHELL : '/bin/bash';
}
function getTerminalDefaultShellWindows(platform: IPlatformService): string {
    const isAtLeastWindows10 = parseFloat(platform.osRelease) >= 10;
    const is32ProcessOn64Windows = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
    const powerShellPath = `${process.env.windir}\\${
        is32ProcessOn64Windows ? 'Sysnative' : 'System32'
    }\\WindowsPowerShell\\v1.0\\powershell.exe`;
    return isAtLeastWindows10 ? powerShellPath : getWindowsShell();
}

function getWindowsShell(): string {
    return process.env.comspec || 'cmd.exe';
}
