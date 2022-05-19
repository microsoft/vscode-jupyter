import { commands, NotebookDocument, Uri } from 'vscode';
import { JUPYTER_SERVER_URI } from '../../constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function startJupyterServer(notebook?: NotebookDocument): Promise<any> {
    // Server URI should have been embedded in the constants file
    const uri = Uri.parse(JUPYTER_SERVER_URI);
    console.log(`ServerURI for remote test: ${JUPYTER_SERVER_URI}`);
    // Use this URI to set our jupyter server URI
    return commands.executeCommand('jupyter.selectjupyteruri', false, uri, notebook);
}
