// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { instance, mock, when } from 'ts-mockito';
import {
    CancellationToken,
    NotebookCell,
    NotebookCellExecution,
    NotebookCellExecutionSummary,
    NotebookCellKind,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookDocument,
    NotebookRange,
    TextDocument,
    Uri,
    workspace
} from 'vscode';
import { IKernelController } from '../../../kernels/types';
import { InteractiveWindowView, JupyterNotebookView, PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { ReadWrite } from '../../../platform/common/types';
import { MockNotebookDocuments } from './helper';
import { useCustomMetadata } from '../../../platform/common/utils';

export function createKernelController(controllerId = '1'): IKernelController {
    return {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        createNotebookCellExecution: (cell: NotebookCell) => new TestNotebookCellExecution(cell),
        id: controllerId
    };
}
class TestNotebookCellExecution implements NotebookCellExecution {
    public readonly cell: NotebookCell;
    public readonly token: CancellationToken;
    public get executionOrder(): number | undefined {
        return this.cell.executionSummary?.executionOrder;
    }
    public set executionOrder(executionOrder: number | undefined) {
        const timing = this.cell.executionSummary?.timing;
        (this.cell as ReadWrite<NotebookCell>).executionSummary = {
            executionOrder,
            timing
        };
    }
    private startTime?: number;
    constructor(cell: NotebookCell) {
        this.cell = cell;
    }
    start(startTime?: number): void {
        this.startTime = startTime;
        (this.cell as ReadWrite<NotebookCell>).executionSummary = {};
    }
    end(success: boolean | undefined, endTime?: number | undefined): void {
        (this.cell as ReadWrite<NotebookCell>).executionSummary = {
            success,
            executionOrder: this.executionOrder || this.cell.executionSummary?.executionOrder,
            timing: endTime && this.startTime ? { startTime: this.startTime, endTime } : undefined
        };
    }
    async clearOutput(cell?: NotebookCell | undefined): Promise<void> {
        const cellToEdit = cell || this.cell;
        (cellToEdit.outputs as NotebookCellOutput[]).length = 0;
    }
    async replaceOutput(
        out: NotebookCellOutput | readonly NotebookCellOutput[],
        cell?: NotebookCell | undefined
    ): Promise<void> {
        const cellToEdit = cell || this.cell;
        const items = Array.isArray(out) ? out : [out];
        if (cellToEdit.outputs.length) {
            (cellToEdit.outputs as NotebookCellOutput[]).splice(0, cellToEdit.outputs.length);
        }
        (cellToEdit.outputs as NotebookCellOutput[]).push(...items);
    }
    async appendOutput(
        out: NotebookCellOutput | readonly NotebookCellOutput[],
        cell?: NotebookCell | undefined
    ): Promise<void> {
        const cellToEdit = cell || this.cell;
        const items = Array.isArray(out) ? out : [out];
        (cellToEdit.outputs as NotebookCellOutput[]).push(...items);
    }
    async replaceOutputItems(
        items: NotebookCellOutputItem | readonly NotebookCellOutputItem[],
        output: NotebookCellOutput
    ): Promise<void> {
        const outputItems = Array.isArray(items) ? items : [items];
        output.items = outputItems;
    }
    async appendOutputItems(
        items: NotebookCellOutputItem | readonly NotebookCellOutputItem[],
        output: NotebookCellOutput
    ): Promise<void> {
        const outputItems = Array.isArray(items) ? items : [items];
        output.items.push(...outputItems);
    }
}

export class TestNotebookDocument implements NotebookDocument {
    public cells: TestNotebookCell[] = [];
    public get cellCount(): number {
        return this.cells.length;
    }
    constructor(
        public readonly uri: Uri = Uri.file(`untitled${Date.now()}.ipynb`),
        public readonly notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView = JupyterNotebookView,
        public metadata: {} = useCustomMetadata() ? { custom: {} } : {},
        public isUntitled = true,
        public version: number = 0,
        public isDirty = false,
        public isClosed = false
    ) {
        MockNotebookDocuments.push(this);
    }
    static async openFile(uri: Uri): Promise<TestNotebookDocument> {
        const notebook = await workspace.openNotebookDocument(uri);
        // Its simpler to use VSCode to de-serialize an ipynb, else we need to write more code in the tests.
        // This could be made faster by reading & parsing the ipynb ourselves instead of relying on VS Code.
        const nb = new TestNotebookDocument(uri, JupyterNotebookView, notebook.metadata as any, false);
        await Promise.all(
            notebook.getCells().map((cell) => {
                if (cell.kind === NotebookCellKind.Code) {
                    return nb.appendCodeCell(cell.document.getText(), cell.document.languageId, cell.metadata);
                } else {
                    return nb.appendMarkdownCell(cell.document.getText(), cell.metadata);
                }
            })
        );
        return nb;
    }
    public async appendCodeCell(
        content: string,
        language: string = PYTHON_LANGUAGE,
        metadata: { readonly [key: string]: any } = {}
    ): Promise<TestNotebookCell> {
        const textDoc = await createTextDocument({ language, content });
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const cell = new TestNotebookCell(this, textDoc, NotebookCellKind.Code, 'text/plain', metadata);
        this.cells.push(cell);
        return cell;
    }
    public async insertCodeCell(
        index: number,
        content: string,
        language: string = PYTHON_LANGUAGE,
        metadata: { readonly [key: string]: any } = {}
    ): Promise<TestNotebookCell> {
        const textDoc = await createTextDocument({ language, content });
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const cell = new TestNotebookCell(this, textDoc, NotebookCellKind.Code, 'text/plain', metadata);
        this.cells.splice(index, 0, cell);
        return cell;
    }
    public async appendMarkdownCell(
        content: string,
        metadata: { readonly [key: string]: any } = {}
    ): Promise<TestNotebookCell> {
        const textDoc = await createTextDocument({ language: 'markdown', content });
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const cell = new TestNotebookCell(this, textDoc, NotebookCellKind.Markup, 'text/markdown', metadata);
        this.cells.push(cell);
        return cell;
    }
    public async insertMarkdownCell(
        index: number,
        content: string,
        metadata: { readonly [key: string]: any } = {}
    ): Promise<TestNotebookCell> {
        const textDoc = await createTextDocument({ language: 'markdown', content });
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const cell = new TestNotebookCell(this, textDoc, NotebookCellKind.Markup, 'text/markdown', metadata);
        this.cells.splice(index, 0, cell);
        return cell;
    }

    cellAt(index: number): NotebookCell {
        return this.cells[index];
    }
    getCells(range?: NotebookRange | undefined): TestNotebookCell[] {
        return range && !range.isEmpty
            ? this.cells.filter((_, index) => range.start >= index && range.end <= index)
            : this.cells;
    }
    async save(): Promise<boolean> {
        return true;
    }
}

async function createTextDocument({ language, content }: { language: string; content: string }) {
    let textDoc = await workspace.openTextDocument({ language, content });
    if (textDoc) {
        return textDoc;
    }
    textDoc = mock<TextDocument>();
    when(textDoc.languageId).thenReturn(language);
    when(textDoc.getText()).thenReturn(content);
    (instance(textDoc) as any).then = undefined;
    return instance(textDoc);
}
export class TestNotebookCell implements NotebookCell {
    public get index(): number {
        return this.notebook.cells.findIndex((c) => c === this);
    }
    public outputs: NotebookCellOutput[] = [];
    public executionSummary: NotebookCellExecutionSummary | undefined;
    constructor(
        public readonly notebook: TestNotebookDocument,
        public readonly document: TextDocument,
        public readonly kind: NotebookCellKind,
        public readonly mime: string,
        public readonly metadata: { readonly [key: string]: any } = {}
    ) {
        this.notebook = notebook;
        this.kind = kind;
        this.metadata = {};
        this.outputs = [];
    }
}
