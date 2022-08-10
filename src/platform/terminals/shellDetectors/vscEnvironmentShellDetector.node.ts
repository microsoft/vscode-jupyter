// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Terminal } from 'vscode';
import { IApplicationEnvironment } from '../../common/application/types';
import { traceVerbose } from '../../logging';
import { ShellIdentificationTelemetry, TerminalShellType } from '../types';
import { BaseShellDetector } from './baseShellDetector.node';

/**
 * Identifies the shell, based on the VSC Environment API.
 *
 * @export
 * @class VSCEnvironmentShellDetector
 * @extends {BaseShellDetector}
 */
@injectable()
export class VSCEnvironmentShellDetector extends BaseShellDetector {
    constructor(@inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment) {
        super(3);
    }
    public identify(
        telemetryProperties: ShellIdentificationTelemetry,
        terminal?: Terminal
    ): TerminalShellType | undefined {
        const shellPath =
            terminal?.creationOptions && 'shellPath' in terminal.creationOptions && terminal.creationOptions.shellPath
                ? terminal.creationOptions.shellPath
                : this.appEnv.shell;
        if (!shellPath) {
            return;
        }
        const shell = this.identifyShellFromShellPath(shellPath);
        traceVerbose(`Terminal shell path '${shellPath}' identified as shell '${shell}'`);
        telemetryProperties.shellIdentificationSource =
            shell === TerminalShellType.other ? telemetryProperties.shellIdentificationSource : 'vscode';
        telemetryProperties.failed = shell === TerminalShellType.other ? false : true;
        return shell;
    }
}
