import { injectable } from 'inversify';
import { CancellationToken, CodeLens, Position, Range, TextDocument } from 'vscode';
import { Commands } from '../datascience/constants';
import { generateCommand } from '../datascience/editor-integration/codeLensFactory';
import { IGitHubIssueCodeLensProvider } from '../datascience/types';
import { GitHubIssue } from './utils/localize';

@injectable()
export class GitHubIssueCodeLensProvider implements IGitHubIssueCodeLensProvider {
    public provideCodeLenses(_document: TextDocument, _token: CancellationToken): CodeLens[] {
        const range = new Range(new Position(0, 0), new Position(0, 1));
        return [new CodeLens(range, generateCommand(Commands.SubmitGitHubIssue, GitHubIssue.submitGitHubIssue()))];
    }
}
