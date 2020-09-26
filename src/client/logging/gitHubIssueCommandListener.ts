import { Octokit } from '@octokit/rest';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { authentication, Position, Uri, window, workspace, WorkspaceEdit } from 'vscode';
import { IApplicationEnvironment, IApplicationShell, ICommandManager } from '../common/application/types';
import { traceError } from '../common/logger';
import { IPlatformService } from '../common/platform/types';
import { IDisposableRegistry, IExtensionContext } from '../common/types';
import { GitHubIssue } from '../common/utils/localize';
import { Commands } from '../datascience/constants';
import {
    IDataScienceCommandListener,
    IDataScienceFileSystem,
    IInteractiveWindowProvider,
    INotebookProvider
} from '../datascience/types';
import { IInterpreterService } from '../interpreter/contracts';

@injectable()
export class GitHubIssueCommandListener implements IDataScienceCommandListener {
    private logfilePath: string;
    private issueFilePath: Uri | undefined;
    constructor(
        @inject(IDataScienceFileSystem) private filesystem: IDataScienceFileSystem,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IApplicationEnvironment) private applicationEnvironment: IApplicationEnvironment,
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider
    ) {
        this.logfilePath = path.join(this.extensionContext.globalStoragePath, 'log.txt');
    }
    public register(commandManager: ICommandManager): void {
        this.disposableRegistry.push(
            ...[
                commandManager.registerCommand(Commands.CreateGitHubIssue, this.createGitHubIssue, this),
                commandManager.registerCommand(Commands.SubmitGitHubIssue, this.submitGitHubIssue, this)
            ]
        );
    }
    private async createGitHubIssue() {
        try {
            const body = await this.filesystem.readLocalFile(this.logfilePath);
            const formatted = `# Steps to cause the bug to occur
1. <!-- ${GitHubIssue.pleaseFillThisOut()} -->
# Actual behavior
<!-- ${GitHubIssue.pleaseFillThisOut()} -->
# Expected behavior
<!-- ${GitHubIssue.pleaseFillThisOut()} -->
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

            // Create and open an untitled file with our issue template
            this.issueFilePath = Uri.file('issue.md').with({
                scheme: 'untitled'
            });
            await workspace.openTextDocument(this.issueFilePath);
            const edit = new WorkspaceEdit();
            edit.insert(this.issueFilePath, new Position(0, 0), formatted);
            await workspace.applyEdit(edit);
            this.commandManager.executeCommand('vscode.open', this.issueFilePath);
        } catch (err) {
            traceError(err);
        }
    }

    // After the user has reviewed the contents, submit the issue on their behalf
    private async submitGitHubIssue() {
        try {
            const editors = window.visibleTextEditors.filter(
                (e) => e.document.uri.toString() === this.issueFilePath?.toString()
            );
            if (editors.length === 1) {
                const editor = editors[0];
                const body = editor.document.getText();
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
                        await this.appShell.showInformationMessage(
                            GitHubIssue.success().format(response.data.html_url)
                        );
                    }
                }
            }
        } catch (err) {
            await this.appShell.showErrorMessage(GitHubIssue.failure());
        }
    }
}
