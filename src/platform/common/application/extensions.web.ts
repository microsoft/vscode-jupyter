// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { Event, Extension, extensions } from 'vscode';
import { IExtensions } from '../types';
import { DataScience } from '../utils/localize';
import { JVSC_EXTENSION_ID, unknownExtensionId } from '../constants';
import { parseStack } from '../../errors';
import { traceError } from '../../logging';

/**
 * Provides functions for tracking the list of extensions that VS code has installed (besides our own)
 */
@injectable()
export class Extensions implements IExtensions {
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
            const jupyterExtRoot = this.getExtension(JVSC_EXTENSION_ID)!.extensionUri.toString().toLowerCase();
            const frames = stack
                .split('\n')
                .map((f) => {
                    const result = /\((.*)\)/.exec(f);
                    if (result) {
                        return result[1];
                    }
                })
                // Since this is web, look for paths that start with http (which also includes https).
                .filter((item) => item && item.toLowerCase().startsWith('http'))
                .filter((item) => item && !item.toLowerCase().startsWith(jupyterExtRoot)) as string[];
            parseStack(new Error('Ex')).forEach((item) => {
                const fileName = item.getFileName();
                if (fileName && !fileName.toLowerCase().startsWith(jupyterExtRoot)) {
                    frames.push(fileName);
                }
            });
            for (const frame of frames) {
                const matchingExt = this.all.find(
                    (ext) => ext.id !== JVSC_EXTENSION_ID && frame.startsWith(ext.extensionUri.toString())
                );
                if (matchingExt) {
                    return { extensionId: matchingExt.id, displayName: matchingExt.packageJSON.displayName };
                }
            }
            traceError(`Unable to determine the caller of the extension API for trace stack.`, stack);
        }
        return { extensionId: unknownExtensionId, displayName: DataScience.unknownPackage };
    }
}
