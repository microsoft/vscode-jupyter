import { NotebookCellExecutionTask, NotebookDocument, NotebookKernelOptions, NotebookSelector } from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { IExtensionContext } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { Commands } from '../constants';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { traceCellMessage } from './helpers/helpers';

export class VSCodeNotebookKernelOptions implements NotebookKernelOptions {
    private notebookKernels = new WeakMap<NotebookDocument, IKernel>();
    get id(): string {
        return this.selection.id;
    }

    get selector(): NotebookSelector {
        return { viewType: 'jupyter-notebook' };
    }

    get supportedLanguages(): string[] {
        // IANHU: Just for testing, will add more later
        return ['python'];
    }

    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly detail: string,
        public readonly selection: Readonly<KernelConnectionMetadata>,
        public readonly isPreferred: boolean,
        private readonly _kernelProvider: IKernelProvider,
        private readonly _notebook: IVSCodeNotebook,
        private readonly _context: IExtensionContext,
        private readonly _preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        private readonly commandManager: ICommandManager
    ) {}

    // Interrupt the given NotebookDocument
    public interruptHandler(notebook: NotebookDocument) {
        notebook.getCells().forEach((cell) => traceCellMessage(cell, 'Cell cancellation requested'));
        this.commandManager
            .executeCommand(Commands.NotebookEditorInterruptKernel, notebook)
            .then(noop, (ex) => console.error(ex));
    }

    public async executeHandler(executions: NotebookCellExecutionTask[]) {
        if (executions.length < 1) {
            return;
        }
        // IANHU: Will these all be coming from the same document?
        const executionUri = executions[0].document.uri;

        // When we receive a cell execute request, first ensure that the notebook is trusted.
        // If it isn't already trusted, block execution until the user trusts it.
        const isTrusted = await this.commandManager.executeCommand(Commands.TrustNotebook, executionUri);
        if (!isTrusted) {
            return;
        }
    }
}
