// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { injectable, inject } from 'inversify';
import { TextDocumentChangeEvent, Range, Position, languages, workspace, TextDocument, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IDocumentManager } from '../../common/application/types';
import { IConfigurationService, IDisposableRegistry } from '../../common/types';
import { isNotebookCell } from '../../common/utils/misc';
import { INotebookControllerManager } from './types';
import { VSCodeNotebookController } from './vscodeNotebookController';

// This list comes from here: https://ipython.readthedocs.io/en/stable/interactive/magics.html#cell-magics
const LanguageMagics = [
    ['%%sql', 'sql'],
    ['%%bash', 'shellscript'],
    ['%%sh', 'shellscript'],
    ['%%kql', 'kql'],
    ['%%javascript', 'javascript'],
    ['%%js', 'javascript'],
    ['%%html', 'html'],
    ['%%ruby', 'ruby'],
    ['%%perl', 'perl'],
    ['%%script sql', 'sql'],
    ['%%script bash', 'shellscript'],
    ['%%script sh', 'shellscript'],
    ['%%script kql', 'kql'],
    ['%%script javascript', 'javascript'],
    ['%%script js', 'javascript'],
    ['%%script html', 'html'],
    ['%%script ruby', 'ruby'],
    ['%%script perl', 'perl'],
    ['%%python', 'python'],
    ['%%python2', 'python'],
    ['%%pypy', 'python'],
    ['%%script python', 'python'],
    ['%%script python2', 'python'],
    ['%%script pypy', 'python']
];

@injectable()
export class LanguageSwitcher implements IExtensionSingleActivationService {
    constructor(
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(INotebookControllerManager) private controllerManager: INotebookControllerManager
    ) {}
    public async activate(): Promise<void> {
        this.documentManager.onDidChangeTextDocument(this.onDidChangeTextDocument, this, this.disposables);
        this.controllerManager.onNotebookControllerSelected(this.onDidChangeKernelSelection, this, this.disposables);
    }

    private onDidChangeTextDocument(e: TextDocumentChangeEvent) {
        // See if this is a notebook cell or not for a python run notebook
        if (
            isNotebookCell(e.document.uri) &&
            this.configService.getSettings().switchCellsOnMagic &&
            this.hasPythonController(e.document)
        ) {
            this.switchOnMatch(e, LanguageMagics);
        }
    }

    private onDidChangeKernelSelection(e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) {
        if (this.isPythonController(e.controller)) {
            // Go through all of the cells and see if any have a match for a language change
            e.notebook.getCells().forEach((c) => {
                const lines = c.document.getText().splitLines();
                const match = LanguageMagics.find((m) => lines.find((l) => l.includes(m[0])));
                if (match) {
                    void languages.setTextDocumentLanguage(c.document, match[1]);
                }
            });
        }
    }

    private isPythonController(controller: VSCodeNotebookController | undefined) {
        switch (controller?.connection.kind) {
            case 'startUsingPythonInterpreter':
                return true;
            case 'startUsingLocalKernelSpec':
            case 'startUsingRemoteKernelSpec':
                return controller.connection.kernelSpec.language === 'python';
            case 'connectToLiveKernel':
                return controller.connection.kernelModel.language === 'python';
            default:
                return false;
        }
    }

    private hasPythonController(cellDocument: TextDocument): boolean {
        const notebook = workspace.notebookDocuments.find((n) => n.getCells().find((c) => c.document === cellDocument));
        const controller = notebook ? this.controllerManager.getSelectedNotebookController(notebook) : undefined;
        return this.isPythonController(controller);
    }

    private switchOnMatch(e: TextDocumentChangeEvent, setToMatch: string[][]) {
        // See if the change would add a language magic
        const line = e.contentChanges[0].range.start.line;
        const possibleText = e.document.getText(new Range(new Position(line, 0), new Position(line + 1, 0))).trim();
        const match = setToMatch.find((e) => possibleText.includes(e[0]));
        if (match) {
            void languages.setTextDocumentLanguage(e.document, match[1]);
        }
    }
}
