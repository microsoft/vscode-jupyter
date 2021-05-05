// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { RemoteServerPickerExample } from './serverPicker';
import { IJupyterExtensionApi } from './typings/jupyter';

// Register our URI picker
export async function activate(_context: vscode.ExtensionContext) {
    const jupyter = vscode.extensions.getExtension<IJupyterExtensionApi>('ms-toolsai.jupyter');
    if (jupyter) {
        if (!jupyter.isActive) {
            await jupyter.activate();
            await jupyter.exports.ready;
        }
        jupyter.exports.registerRemoteServerProvider(new RemoteServerPickerExample());
        vscode.commands.registerCommand(
            'ms-toolsai-test.createBlankNotebook',
            () => void jupyter.exports.createBlankNotebook({ defaultCellLanguage: 'julia' })
        );
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
    // Don't do anything at the moment here.
}
