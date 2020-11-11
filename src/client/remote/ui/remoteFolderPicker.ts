import { inject, injectable } from 'inversify';
import * as path from 'path';
import { FileType, QuickInputButton, QuickPickItem, ThemeIcon, Uri } from 'vscode';
import {
    IMultiStepInputFactory,
    InputStep,
    IQuickPickParameters,
    MultiStepInput
} from '../../common/utils/multiStepInput';
import { JupyterServerConnectionService } from '../connection/remoteConnectionsService';
import { RemoteFileSystem } from './fileSystem';
import { RemoteFileSystemFactory } from './fileSystemFactory';
import { IJupyterServerConnectionService, JupyterServerConnection } from './types';

type FolderSelectionState = {
    currentFolder?: Uri;
    parents: Uri[];
    fileSystem?: RemoteFileSystem;
    connection?: JupyterServerConnection;
};

// tslint:disable-next-line: interface-name
interface QuickPickFolder extends QuickPickItem {
    path: string;
}
// tslint:disable-next-line: interface-name
interface QuickPickConnection extends QuickPickItem {
    connection: JupyterServerConnection;
}

@injectable()
export class RemoteFilePickerProvider {
    constructor(
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(RemoteFileSystemFactory) private readonly fsFactory: RemoteFileSystemFactory,
        @inject(IJupyterServerConnectionService) private readonly connectionService: JupyterServerConnectionService
    ) {}
    public async selectFolder(): Promise<Uri | undefined> {
        const step = this.multiStepFactory.create<FolderSelectionState>();
        const state: FolderSelectionState = { parents: [] };
        await step.run(this.nextStep.bind(this), state);
        // tslint:disable-next-line: no-console
        console.log('1');
        return state.currentFolder;
    }
    private async nextStep(
        input: MultiStepInput<FolderSelectionState>,
        state: FolderSelectionState
    ): Promise<InputStep<FolderSelectionState> | void> {
        const selection = await this.pickServer(input, state);
        // const selection = await this.pickFolder(input, state);
        // tslint:disable-next-line: no-console
        console.log(selection);
    }
    private async pickServer(input: MultiStepInput<FolderSelectionState>, state: FolderSelectionState): Promise<void> {
        const connections = await this.connectionService.getConnections();
        if (connections.length === 0) {
            return;
        }
        // if (connections.length === 1) {
        //     state.server = connections[0];
        //     return this.pickFolder(input, state);
        // }
        const items: QuickPickConnection[] = connections.map((item) => {
            return {
                label: `$(folder) ${item.displayName}`,
                connection: item
            };
        });
        const response: QuickPickConnection | undefined = await input.showQuickPick<
            QuickPickConnection,
            IQuickPickParameters<QuickPickConnection>
        >({
            title: `Folders on Remote Jupyter Server`,
            items,
            canGoBack: false,
            acceptFilterBoxTextAsSelection: false,
            placeholder: `Select server`
        });
        const selection = (response as unknown) as QuickPickConnection | undefined;
        if (selection?.connection) {
            if (state.parents.length) {
                const fileSystem = this.fsFactory.getRemoteFileSystem(selection.connection.fileScheme);
                if (!fileSystem) {
                    throw new Error('No server');
                }
                state.connection = selection.connection;
                state.fileSystem = fileSystem;
                return this.pickFolder(input, state);
            }
        } else {
            state.currentFolder = undefined;
            state.connection = undefined;
        }
        // tslint:disable-next-line: no-console
        console.log(selection);
    }

    private async pickFolder(input: MultiStepInput<FolderSelectionState>, state: FolderSelectionState): Promise<void> {
        const currentFolder = state.currentFolder || Uri.file('/').with({ scheme: state.connection!.fileScheme });
        if (state.parents.length === 0) {
            state.currentFolder = undefined;
        }
        const filesAndFolders = await state.fileSystem!.readDirectory(currentFolder);
        const folders = filesAndFolders
            .filter(([, type]) => type === FileType.Directory)
            .map(([name]) => name)
            .sort((a, b) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
        const items: QuickPickFolder[] = folders.map((item) => {
            return {
                label: `$(folder) ${item}`,
                path: path.join(currentFolder.fsPath, item)
            };
        });
        if (state.parents.length) {
            items.splice(0, 0, {
                // tslint:disable-next-line: no-invalid-template-strings
                label: '$(arrow-up) ...',
                path: state.parents[state.parents.length - 1].fsPath
            });
        }
        const buttons: QuickInputButton[] = [];
        if (state.parents.length) {
            buttons.push({ iconPath: new ThemeIcon('quick-input-back'), tooltip: 'Go back to previous folder' });
        }
        buttons.push({ iconPath: new ThemeIcon('menu-selection'), tooltip: `Select current folder` });
        const response: QuickPickFolder | QuickInputButton | undefined = await input.showQuickPick<
            QuickPickFolder,
            IQuickPickParameters<QuickPickFolder>
        >({
            title: `Folders on Remote Jupyter Server (${state.connection!.displayName})`,
            items,
            buttons,
            canGoBack: false,
            acceptFilterBoxTextAsSelection: false,
            placeholder: `Create a blank notebook in ${currentFolder.fsPath}`
        });
        const selection = (response as unknown) as QuickPickFolder | QuickInputButton | undefined;
        if (selection && 'path' in selection && selection.label.startsWith('$(arrow-up)')) {
            if (state.parents.length) {
                state.currentFolder = state.parents.pop();
                return this.pickFolder(input, state);
            }
        } else if (selection && 'path' in selection) {
            state.parents.push(currentFolder);
            state.currentFolder = Uri.file(selection.path).with({ scheme: state.connection!.fileScheme });
            return this.pickFolder(input, state);
        } else if (selection && 'tooltip' in selection && selection.tooltip?.startsWith('Select')) {
            state.currentFolder = currentFolder;
        } else if (selection && 'tooltip' in selection && selection.tooltip?.startsWith('Go')) {
            if (state.parents.length) {
                state.currentFolder = state.parents.pop();
                return this.pickFolder(input, state);
            }
        } else {
            state.currentFolder = undefined;
        }
        // tslint:disable-next-line: no-console
        console.log(selection);
    }
}
