// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { extensions } from 'vscode';
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
    public determineExtensionFromCallStack(stack?: string): { extensionId: string; displayName: string } {
        stack = stack || new Error().stack;
        if (stack) {
            const jupyterExtRoot = extensions.getExtension(JVSC_EXTENSION_ID)!.extensionUri.toString().toLowerCase();
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
                const matchingExt = extensions.all.find(
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
