// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as vscode from 'vscode';
import { areStringPathsSame } from './fileUtils';

const ENCODING = 'utf8';

export async function writeFile(uri: vscode.Uri, text: string | Buffer): Promise<void> {
    const data = typeof text === 'string' ? Buffer.from(text) : text;
    return vscode.workspace.fs.writeFile(uri, data);
}

export async function readFile(uri: vscode.Uri): Promise<string> {
    const result = await vscode.workspace.fs.readFile(uri);
    const data = Buffer.from(result);
    return data.toString(ENCODING);
}

export async function deleteFile(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.delete(uri);
}

export function areLocalPathsSame(path1: string, path2: string): boolean {
    return areStringPathsSame(path1, path2);
}

export function arePathsSame(path1: vscode.Uri, path2: vscode.Uri): boolean {
    if (path1.scheme === 'file' && path1.scheme === path2.scheme) {
        // eslint-disable-next-line local-rules/dont-use-fspath
        return areLocalPathsSame(path1.fsPath, path2.fsPath);
    } else {
        return path1.toString() === path2.toString();
    }
}