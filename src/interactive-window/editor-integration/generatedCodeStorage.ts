// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IGeneratedCode, IFileHashes, IGeneratedCodeStore } from './types';

type CodeFileUriAsString = string;
export class GeneratedCodeStorage implements IGeneratedCodeStore {
    private cellHashes = new Map<CodeFileUriAsString, IGeneratedCode[]>();
    clear(): void {
        this.cellHashes.clear();
    }
    public get all(): IFileHashes[] {
        return [...this.cellHashes.entries()]
            .map((e) => {
                return {
                    uri: Uri.parse(e[0]),
                    hashes: e[1].filter((h) => !h.deleted)
                };
            })
            .filter((e) => e.hashes.length > 0);
    }
    getFileHashes(fileUri: Uri): IGeneratedCode[] {
        return this.cellHashes.get(fileUri.toString()) || [];
    }
    store(fileUri: Uri, info: IGeneratedCode): void {
        const list = this.cellHashes.get(fileUri.toString()) || [];

        // Figure out where to put the item in the list
        let inserted = false;
        for (let i = 0; i < list.length && !inserted; i += 1) {
            const pos = list[i];
            if (info.line >= pos.line && info.line <= pos.endLine) {
                // Stick right here. This is either the same cell or a cell that overwrote where
                // we were.
                list.splice(i, 1, info);
                inserted = true;
            } else if (pos.line > info.line) {
                // This item comes just after the cell we're inserting.
                list.splice(i, 0, info);
                inserted = true;
            }
        }
        if (!inserted) {
            list.push(info);
        }
        this.cellHashes.set(fileUri.toString(), list);
    }
}
