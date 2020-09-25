import { Octokit } from '@octokit/rest';
import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import { authentication, Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationShell, ICommandManager } from '../common/application/types';
import { traceError } from '../common/logger';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext,
    IMemento
} from '../common/types';
import { Common, Logging } from '../common/utils/localize';
import { Commands } from '../datascience/constants';
import { IDataScienceFileSystem } from '../datascience/types';
import { addLogfile } from './_global';
import { LogLevel } from './levels';

const SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE = 'SeenDebugLogLevelAtLeastOnce';
const SHOULD_WARN_ABOUT_LOGGING = 'ShouldWarnAboutLogging';

@injectable()
export class DebugLoggingManager implements IExtensionSingleActivationService {
    private logfilePath: string;
    constructor(
        @inject(IDataScienceFileSystem) private filesystem: IDataScienceFileSystem,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: Memento,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        this.logfilePath = path.join(this.extensionContext.globalStoragePath, 'log.txt');
        this.disposables.push(this.commandManager.registerCommand(Commands.OpenLogFile, this.createGitHubIssue, this));
    }

    public async activate() {
        const logLevelSetting = this.configService.getSettings().logging.level;
        const seenDebugAtLeastOnce = this.globalState.get<boolean>(
            SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE,
            false
        );
        if (
            logLevelSetting === LogLevel.Debug &&
            seenDebugAtLeastOnce &&
            this.globalState.get<boolean>(SHOULD_WARN_ABOUT_LOGGING, true)
        ) {
            await this.warnUserAboutLoggingToFile();
        } else if (logLevelSetting === LogLevel.Debug && !seenDebugAtLeastOnce) {
            await this.configureLoggingToFile();
        }
    }

    private async configureLoggingToFile() {
        await this.filesystem.writeLocalFile(this.logfilePath, ''); // Overwrite existing logfile if any
        addLogfile(this.logfilePath);
        this.globalState.update(SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE, true);
    }

    private async warnUserAboutLoggingToFile() {
        const prompts = [Logging.bannerYesTurnOffDebugLogging(), Common.doNotShowAgain()];
        const selection = await this.appShell.showWarningMessage(
            Logging.warnUserAboutDebugLoggingSetting(),
            ...prompts
        );
        switch (selection) {
            case Logging.bannerYesTurnOffDebugLogging():
                this.globalState.update(SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE, false);
                this.commandManager.executeCommand(Commands.ResetLoggingLevel);
                return;
            case Common.doNotShowAgain():
                this.globalState.update(SHOULD_WARN_ABOUT_LOGGING, false);
                break;
            default:
                break;
        }
        await this.configureLoggingToFile();
    }

    private async createGitHubIssue() {
        try {
            const body = await this.filesystem.readLocalFile(this.logfilePath);
            const formatted = `<details>${body}</details>`;
            const authSession = await authentication.getSession('github', ['repo'], { createIfNone: true });
            if (authSession) {
                const octokit = new Octokit({ auth: authSession.accessToken });
                await octokit.issues.create({
                    owner: 'microsoft',
                    repo: 'vscode-jupyter',
                    title: 'Bug report',
                    body: formatted
                });
            }
        } catch (err) {
            traceError(err);
        }
    }
}
