// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Event, Extension, extensions, Uri } from 'vscode';
import { EXTENSION_ROOT_DIR } from '../constants';
import { IExtensions } from '../types';
import { DataScience } from '../utils/localize';
import { IFileSystem } from '../platform/types.node';
import * as stacktrace from 'stack-trace';

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
                .filter((item) => item && !item.toLowerCase().startsWith(jupyterExtRoot)) as string[];
            stacktrace.parse(new Error('Ex')).forEach((item) => {
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
                    const possiblePackageJson = path.join(dirName, 'package.json');
                    if (await this.fs.localFileExists(possiblePackageJson)) {
                        const text = await this.fs.readFile(Uri.file(possiblePackageJson));
                        try {
                            const json = JSON.parse(text);
                            return { extensionId: `${json.publisher}.${json.name}`, displayName: json.displayName };
                        } catch {
                            // If parse fails, then not the extension
                        }
                    }
                    last = dirName;
                    dirName = path.dirname(dirName);
                }
            }
        }
        return { extensionId: DataScience.unknownPackage(), displayName: DataScience.unknownPackage() };
    }
}
