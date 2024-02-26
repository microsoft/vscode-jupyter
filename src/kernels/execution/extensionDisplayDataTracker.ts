// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCellOutput } from 'vscode';
import { IKernelSession } from '../types';
import { getNotebookCellOutputMetadata } from './helpers';

type Extension = string;
const displayIdsByExtension = new WeakMap<IKernelSession, Map<Extension, string[]>>();

export function isDisplayDataTrackedTestOnly(kernel: IKernelSession) {
    return displayIdsByExtension.has(kernel);
}
export function trackDisplayDataForExtension(extension: string, kernel: IKernelSession, output: NotebookCellOutput) {
    const metadata = getNotebookCellOutputMetadata(output);
    const displayId = metadata?.transient?.display_id;
    if (output.metadata?.outputType !== 'display_data' || !displayId) {
        return;
    }
    const extensionMap = displayIdsByExtension.get(kernel) || new Map<Extension, string[]>();
    displayIdsByExtension.set(kernel, extensionMap);
    const displayIds = extensionMap.get(extension) || [];
    extensionMap.set(extension, displayIds);
    displayIds.push(displayId);
    // Lets put a limit on the number of displayIds we store per extension.
    if (displayIds.length > 1000) {
        displayIds.shift();
    }
}

export function isDisplayIdTrackedForAnExtension(kernel: IKernelSession, displayId: string) {
    const extensionMap = displayIdsByExtension.get(kernel) || new Map<Extension, string[]>();
    for (const displayIds of extensionMap.values()) {
        if (displayIds.includes(displayId)) {
            return true;
        }
    }
    return false;
}
export function isDisplayIdTrackedForExtension(extension: string, kernel: IKernelSession, displayId: string) {
    const extensionMap = displayIdsByExtension.get(kernel) || new Map<Extension, string[]>();
    const displayIds = extensionMap.get(extension) || [];
    return displayIds.includes(displayId);
}

export function unTrackDisplayDataForExtension(kernel: IKernelSession, displayId: string) {
    const extensionMap = displayIdsByExtension.get(kernel) || new Map<Extension, string[]>();
    for (const displayIds of extensionMap.values()) {
        const index = displayIds.indexOf(displayId);
        if (index >= 0) {
            displayIds.splice(index, 1);
        }
    }
}
