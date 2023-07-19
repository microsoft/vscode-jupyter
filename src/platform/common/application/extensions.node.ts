// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { Event, Extension, extensions, Uri } from 'vscode';
import { IExtensions } from '../types';
import { DataScience } from '../utils/localize';
import { EXTENSION_ROOT_DIR } from '../../constants.node';
import { IFileSystem } from '../platform/types';
import { parseStack } from '../../errors';
import { unknownExtensionId } from '../constants';
import { traceError } from '../../logging';

/**
 * Provides functions for tracking the list of extensions that VS code has installed (besides our own)
 */
@injectable()
export class Extensions implements IExtensions {
    constructor(@inject(IFileSystem) private readonly fs: IFileSystem) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get all(): readonly Extension<any>[] {
        return extensions.all;
    }

    public get onDidChange(): Event<void> {
        return extensions.onDidChange;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getExtension(extensionId: any) {
        return extensions.getExtension(extensionId);
    }
    public async determineExtensionFromCallStack(): Promise<{ extensionId: string; displayName: string }> {
        const stack = new Error().stack;
        if (stack) {
            const jupyterExtRoot = path.join(EXTENSION_ROOT_DIR.toLowerCase(), path.sep);
            const frames = stack
                .split('\n')
                .map((f) => {
                    const result = /\((.*)\)/.exec(f);
                    if (result) {
                        return result[1];
                    }
                })
                .filter((item) => item && !item.toLowerCase().startsWith(jupyterExtRoot))
                .filter((item) =>
                    this.all.some(
                        (ext) => item!.includes(ext.extensionUri.path) || item!.includes(ext.extensionUri.fsPath)
                    )
                ) as string[];
            // Work around for https://github.com/microsoft/vscode-jupyter/issues/12550
            parseStack(new Error('Ex')).forEach((item) => {
                const fileName = item.getFileName();
                if (fileName && !fileName.toLowerCase().startsWith(jupyterExtRoot)) {
                    frames.push(fileName);
                }
            });
            for (const frame of frames) {
                // This file is from a different extension. Try to find its package.json
                let dirName = path.dirname(frame);
                let last = frame;
                while (dirName && dirName.length < last.length) {
                    const possiblePackageJson = Uri.file(path.join(dirName, 'package.json'));
                    if (await this.fs.exists(possiblePackageJson)) {
                        const text = await this.fs.readFile(possiblePackageJson);
                        try {
                            const json = JSON.parse(text);
                            // Possible we have another package.json file. Make sure it has an extension id
                            if (json.publisher && json.name && json.displayName) {
                                const extensionId = `${json.publisher}.${json.name}`;
                                const matchingExt = this.getExtension(extensionId);
                                if (
                                    matchingExt &&
                                    matchingExt.id === extensionId &&
                                    frame.startsWith(matchingExt.extensionUri.toString())
                                ) {
                                    return {
                                        extensionId: matchingExt.id,
                                        displayName: matchingExt.packageJSON.displayName
                                    };
                                }
                            }
                        } catch {
                            // If parse fails, then not the extension
                        }
                    }
                    last = dirName;
                    dirName = path.dirname(dirName);
                }
            }
            traceError(`Unable to determine the caller of the extension API for trace stack.`, stack);
        }
        return { extensionId: unknownExtensionId, displayName: DataScience.unknownPackage };
    }
}
