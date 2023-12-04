// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IGeneratedCode, IFileGeneratedCodes, IGeneratedCodeStore } from './types';
import { ResourceMap } from '../../platform/common/utils/map';

/**
 * Stores an IGeneratedCode for each file that is sent to the Interactive Window.
 * IGeneratedCode is a struct describing:
 * - line and file numbers for the code
 * - the real code sent to jupyter (minus cell markers)
 */
export class GeneratedCodeStorage implements IGeneratedCodeStore {
    private codeGeneratorsByFile = new ResourceMap<IGeneratedCode[]>();
    clear(): void {
        this.codeGeneratorsByFile.clear();
    }
    public get all(): IFileGeneratedCodes[] {
        return [...this.codeGeneratorsByFile.entries()]
            .map((e) => {
                return {
                    uri: e[0],
                    generatedCodes: e[1].filter((h) => !h.deleted)
                };
            })
            .filter((e) => e.generatedCodes.length > 0);
    }
    getFileGeneratedCode(fileUri: Uri): IGeneratedCode[] {
        return this.codeGeneratorsByFile.get(fileUri) || [];
    }
    store(fileUri: Uri, info: IGeneratedCode): void {
        const list = this.codeGeneratorsByFile.get(fileUri) || [];

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
        this.codeGeneratorsByFile.set(fileUri, list);
    }
}
