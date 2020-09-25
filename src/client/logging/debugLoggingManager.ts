import { Octokit } from '@octokit/rest';
import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import { authentication, Memento, Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationEnvironment, IApplicationShell, ICommandManager } from '../common/application/types';
import { traceError } from '../common/logger';
import { IPlatformService } from '../common/platform/types';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext,
    IMemento
} from '../common/types';
import { Common, GitHubIssue, Logging } from '../common/utils/localize';
import { Commands } from '../datascience/constants';
import { IDataScienceFileSystem, IInteractiveWindowProvider, INotebookProvider } from '../datascience/types';
import { IInterpreterService } from '../interpreter/contracts';
import { addLogfile } from './_global';
import { LogLevel } from './levels';

const SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE = 'SeenDebugLogLevelAtLeastOnce';
const SHOULD_WARN_ABOUT_LOGGING = 'ShouldWarnAboutLogging';

@injectable()
export class DebugLoggingManager implements IExtensionSingleActivationService {
    private logfilePath: string;
    private issueFilePath: string;
    constructor(
        @inject(IDataScienceFileSystem) private filesystem: IDataScienceFileSystem,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: Memento,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IApplicationEnvironment) private applicationEnvironment: IApplicationEnvironment,
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider
    ) {
        this.logfilePath = path.join(this.extensionContext.globalStoragePath, 'log.txt');
        this.issueFilePath = path.join(this.extensionContext.globalStoragePath, 'issue.md');
        this.disposables.push(
            ...[
                this.commandManager.registerCommand(Commands.CreateGitHubIssue, this.createGitHubIssue, this),
                this.commandManager.registerCommand(Commands.SubmitGitHubIssue, this.submitGitHubIssue, this)
            ]
        );
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
            const formatted = `# Steps to cause the bug to occur
1.
# Actual behavior
XXX
# Expected behavior
XXX
# Your Jupyter environment
Active Python interpreter: ${(await this.interpreterService.getActiveInterpreter(undefined))?.displayName}
Number of interactive windows: ${this.interactiveWindowProvider?.windows?.length}
Number of Jupyter notebooks: ${this.notebookProvider?.activeNotebooks?.length}
Jupyter notebook type: ${this.notebookProvider?.type}
Extension version: ${this.applicationEnvironment?.packageJson?.version}
VS Code version: ${this.applicationEnvironment?.vscodeVersion}
OS: ${this.platformService.osType} ${(await this.platformService?.getVersion())?.version}

<details>

${'```'}
${body}
${'```'}
</details>`;

            // Open a markdown file for the user to review and remove PII
            await this.filesystem.writeLocalFile(this.issueFilePath, formatted);
            this.commandManager.executeCommand('vscode.open', Uri.file(this.issueFilePath));
        } catch (err) {
            traceError(err);
        }
    }

    // After the user has reviewed the contents, submit the issue on their behalf
    private async submitGitHubIssue() {
        try {
            const body = await this.filesystem.readLocalFile(this.issueFilePath);
            const authSession = await authentication.getSession('github', ['repo'], { createIfNone: true });
            if (authSession) {
                const octokit = new Octokit({ auth: authSession.accessToken });
                const response = await octokit.issues.create({
                    owner: 'microsoft',
                    repo: 'vscode-jupyter',
                    title: 'Bug report',
                    body
                });
                if (response?.data?.html_url) {
                    await this.appShell.showInformationMessage(GitHubIssue.success().format(response.data.html_url));
                }
            }
        } catch (err) {
            await this.appShell.showErrorMessage(GitHubIssue.failure());
        }
    }
}
