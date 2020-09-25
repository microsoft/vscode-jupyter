import { injectable } from 'inversify';
import { CodeLens, Position, Range } from 'vscode';
import { Commands } from '../datascience/constants';
import { generateCommand } from '../datascience/editor-integration/codeLensFactory';
import { IGitHubIssueCodeLensProvider } from '../datascience/types';
import { DataScience } from './utils/localize';

@injectable()
export class GitHubIssueCodeLensProvider implements IGitHubIssueCodeLensProvider {
    public provideCodeLenses(): CodeLens[] {
        const range = new Range(new Position(0, 0), new Position(0, 1));
        return [new CodeLens(range, generateCommand(Commands.SubmitGitHubIssue, DataScience.submitGitHubIssue()))];
    }
}
