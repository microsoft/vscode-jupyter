// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Interfaces here to expose specific private functionality to test code
export interface ITestWebviewHost {
    getHTMLById(id: string): Promise<string>;
     
    addMessageListener(callback: (message: string, payload: any) => void): void;
     
    removeMessageListener(callback: (message: string, payload: any) => void): void;
}
