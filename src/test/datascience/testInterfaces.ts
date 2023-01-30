// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Interfaces here to expose specific private functionality to test code
export interface ITestWebviewHost {
    getHTMLById(id: string): Promise<string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addMessageListener(callback: (message: string, payload: any) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeMessageListener(callback: (message: string, payload: any) => void): void;
}
