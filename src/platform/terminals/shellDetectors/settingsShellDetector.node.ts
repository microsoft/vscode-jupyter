// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Terminal } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IPlatformService } from '../../common/platform/types';
import { OSType } from '../../common/utils/platform';
import { traceVerbose } from '../../logging';
import { ShellIdentificationTelemetry, TerminalShellType } from '../types';
import { BaseShellDetector } from './baseShellDetector.node';

/**
 * Identifies the shell based on the user settings.
 *
 * @export
 * @class SettingsShellDetector
 * @extends {BaseShellDetector}
 */
@injectable()
export class SettingsShellDetector extends BaseShellDetector {
    constructor(
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPlatformService) private readonly platform: IPlatformService
    ) {
        super(2);
    }
    public getTerminalShellPath(): string | undefined {
        const shellConfig = this.workspace.getConfiguration('terminal.integrated.shell');
        let osSection = '';
        switch (this.platform.osType) {
            case OSType.Windows: {
                osSection = 'windows';
                break;
            }
            case OSType.OSX: {
                osSection = 'osx';
                break;
            }
            case OSType.Linux: {
                osSection = 'linux';
                break;
            }
            default: {
                return '';
            }
        }
        return shellConfig.get<string>(osSection)!;
    }
    public identify(
        telemetryProperties: ShellIdentificationTelemetry,
        _terminal?: Terminal
    ): TerminalShellType | undefined {
        const shellPath = this.getTerminalShellPath();
        telemetryProperties.hasCustomShell = !!shellPath;
        const shell = shellPath ? this.identifyShellFromShellPath(shellPath) : TerminalShellType.other;

        if (shell !== TerminalShellType.other) {
            telemetryProperties.shellIdentificationSource = 'environment';
        } else {
            telemetryProperties.shellIdentificationSource = 'settings';
        }
        traceVerbose(`Shell path from user settings '${shellPath}'`);
        return shell;
    }
}
