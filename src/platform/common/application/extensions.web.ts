// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { Event, Extension, extensions } from 'vscode';
import { IExtensions } from '../types';
import { DataScience } from '../utils/localize';
import * as stacktrace from 'stack-trace';
import { JVSC_EXTENSION_ID } from '../constants';

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
            const frames = stack
                .split('\n')
                .map((f) => {
                    const result = /\((.*)\)/.exec(f);
                    if (result) {
                        return result[1];
                    }
                })
                .filter((item) => item && !item.toLowerCase().includes(JVSC_EXTENSION_ID)) as string[];
            stacktrace.parse(new Error('Ex')).forEach((item) => {
                const fileName = item.getFileName();
                if (fileName && !fileName.toLowerCase().includes(JVSC_EXTENSION_ID)) {
                    frames.push(fileName);
                }
            });
            // This file is from a different extension. Try to find its package.json
            // TODO: Need to try this in web and see if we can just get the extension information from the path
            // and then use the extensionid to lookup the extension
        }
        return { extensionId: DataScience.unknownPackage(), displayName: DataScience.unknownPackage() };
    }
}
