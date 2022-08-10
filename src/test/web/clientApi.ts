// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { workspace } from 'vscode';

export class ClientAPI {
    static screenShotCount = new Map<string, number>();
    static url: string;
    public static initialize() {
        console.log(`DEBUG_JUPYTER_SERVER_URI={workspace.getConfiguration('jupyter').get('DEBUG_JUPYTER_SERVER_URI')}`);
        const reportServerPor = workspace.getConfiguration('jupyter').get('REPORT_SERVER_PORT') as number;

        const url = `http://127.0.0.1:${reportServerPor}`;
        ClientAPI.url = url;
    }
    public static async sendRawMessage<T>(message: T): Promise<void> {
        await fetch(ClientAPI.url, {
            method: 'post',
            body: JSON.stringify(message),
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
    public static async captureScreenShot(filename: string): Promise<void> {
        await ClientAPI.sendRawMessage({ command: 'captureScreenShot', filename });
    }
}
