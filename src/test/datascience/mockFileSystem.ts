// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { Uri } from 'vscode';
import { DataScienceFileSystem } from '../../client/datascience/dataScienceFileSystem';
import { FakeVSCodeFileSystemAPI } from '../serviceRegistry';

export class MockFileSystem extends DataScienceFileSystem {
    private contentOverloads = new Map<string, string>();

    constructor() {
        super();
        this.vscfs = new FakeVSCodeFileSystemAPI();
    }
    public async readLocalFile(filePath: string): Promise<string> {
        const contents = this.contentOverloads.get(filePath);
        if (contents) {
            return contents;
        }
        return super.readLocalFile(filePath);
    }
    public async writeLocalFile(filePath: string, contents: string): Promise<void> {
        this.contentOverloads.set(filePath, contents);
    }
    public async readFile(filePath: Uri): Promise<string> {
        const contents = this.contentOverloads.get(filePath.fsPath);
        if (contents) {
            return contents;
        }
        return super.readFile(filePath);
    }
    public addFileContents(filePath: string, contents: string): void {
        this.contentOverloads.set(filePath, contents);
    }
}
