import { injectable } from 'inversify';
import { CancellationToken, CodeLens, Position, Range, TextDocument } from 'vscode';
import { Commands } from '../datascience/constants';
import { generateCommand } from '../datascience/editor-integration/codeLensFactory';
import { IGitHubIssueCodeLensProvider } from '../datascience/types';
import { GitHubIssue } from './utils/localize';

@injectable()
export class GitHubIssueCodeLensProvider implements IGitHubIssueCodeLensProvider {
    public provideCodeLenses(document: TextDocument, _token: CancellationToken): CodeLens[] {
        const command = generateCommand(Commands.SubmitGitHubIssue, GitHubIssue.submitGitHubIssue());
        const codelenses: CodeLens[] = [];
        for (let index = 0; index < document.lineCount; index += 1) {
            const line = document.lineAt(index);
            if (line.text.startsWith('<details>')) {
                break;
            }
            if (line.text.startsWith('# ')) {
                const range = new Range(new Position(line.lineNumber, 0), new Position(line.lineNumber, 1));
                codelenses.push(new CodeLens(range, command));
            }
        }
        return codelenses;
    }
}
