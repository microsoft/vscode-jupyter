// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, multiInject } from 'inversify';
import { Terminal, Uri } from 'vscode';
import { sendTelemetryEvent } from '../../telemetry';
import { ITerminalManager, IWorkspaceService } from '../common/application/types';
import { Telemetry } from '../common/constants';
import { disposeAllDisposables } from '../common/helpers';
import { IPlatformService } from '../common/platform/types';
import { IFileSystemNode } from '../common/platform/types.node';
import { IDisposable, IDisposableRegistry, Resource } from '../common/types';
import { sleep, waitForCondition } from '../common/utils/async';
import { noop } from '../common/utils/misc';
import { OSType } from '../common/utils/platform.node';
import { traceError } from '../logging';
import { ShellDetector } from './shellDetector.node';
import { IShellDetector, ITerminalHelper, TerminalShellType } from './types';

/**
 * Uses a terminal to fetch environment variables
 */
@injectable()
export class TerminalHelper implements ITerminalHelper {
    private readonly shellDetector: ShellDetector;
    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(ITerminalManager) private readonly terminalManager: ITerminalManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @multiInject(IShellDetector) shellDetectors: IShellDetector[]
    ) {
        this.shellDetector = new ShellDetector(this.platform, shellDetectors);
    }
    public async getEnvironmentVariables(
        resource: Resource,
        terminal?: Terminal
    ): Promise<{ env?: NodeJS.ProcessEnv; shell: TerminalShellType }> {
        if (this.platform.osType === OSType.Unknown) {
            sendTelemetryEvent(Telemetry.TerminalEnvVariableExtraction, undefined, {
                failed: true,
                reason: 'unknownOs',
                shellType: undefined
            });
            return {
                shell: TerminalShellType.other
            };
        }
        const disposables: IDisposable[] = [];
        let failureReason:
            | 'unknownOs'
            | 'getWorkspace'
            | 'terminalCreation'
            | 'fileCreation'
            | 'shellDetection'
            | 'commandExecution'
            | 'waitForCommand'
            | 'parseOutput'
            | undefined;
        let shell: TerminalShellType | undefined;
        try {
            failureReason = 'getWorkspace';
            const cwd = this.workspace.getWorkspaceFolder(resource)?.uri?.fsPath;
            if (!terminal) {
                failureReason = 'terminalCreation';
                terminal = this.terminalManager.createTerminal({ cwd, hideFromUser: true, isTransient: true });
                this.disposables.push(terminal);
                disposables.push(terminal);
            }
            // Wait for a few seconds for terminal to load and get initialized.
            await sleep(5_000);

            let command: string | undefined;
            failureReason = 'fileCreation';
            const { dispose, filePath } = await this.fs.createTemporaryLocalFile('txt');
            await this.fs.delete(Uri.file(filePath)).catch(noop);
            disposables.push({ dispose });
            failureReason = 'shellDetection';
            shell = this.shellDetector.identifyTerminalShell(terminal);
            switch (this.shellDetector.identifyTerminalShell(terminal)) {
                case TerminalShellType.powershellCore:
                case TerminalShellType.powershell:
                    command = `Get-ChildItem Env: | Select Name | Export-Csv -Path ${filePath.fileToCommandArgument()} -NoTypeInformation`;
                    break;
                case TerminalShellType.commandPrompt:
                    command = `set > ${filePath.fileToCommandArgument()}`;
                    break;

                default:
                    command = `printenv > ${filePath.fileToCommandArgument()}`;
                    break;
            }
            failureReason = 'commandExecution';
            terminal.sendText(command);
            failureReason = 'waitForCommand';
            const filePathUri = Uri.file(filePath);
            await waitForCondition(() => this.fs.exists(filePathUri), 10_000, 100);
            const env = process.env;
            const envContents = await this.fs.readFile(filePathUri);
            failureReason = 'parseOutput';
            envContents.splitLines({ trim: true, removeEmptyEntries: true }).forEach((line) => {
                try {
                    const [key, value] = line.split('=');
                    if (key.trim().length) {
                        env[key.trim()] = value.trim();
                    }
                } catch (ex) {
                    traceError(`Failed to parse environment variable entry for line ${line}`, ex);
                }
            });
            return { env, shell };
        } catch (ex) {
            traceError('Failed to extract environment variables', ex);
            sendTelemetryEvent(Telemetry.TerminalEnvVariableExtraction, undefined, {
                failed: true,
                reason: failureReason,
                shellType: shell
            });
            return {
                shell: TerminalShellType.other
            };
        } finally {
            disposeAllDisposables(disposables);
        }
    }
}
