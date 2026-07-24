// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import * as path from '../platform/vscode-path/path';
import type { DownloadPlatform } from '@vscode/test-electron/out/download';

export function resolveDownloadedVSCodeExecutablePath(
    vscodeExecutablePath: string,
    platform: DownloadPlatform
): string {
    if (!platform.startsWith('darwin') || fs.existsSync(vscodeExecutablePath)) {
        return vscodeExecutablePath;
    }

    const macosDirectory = path.dirname(vscodeExecutablePath);
    try {
        const infoPlist = fs.readFileSync(path.resolve(macosDirectory, '..', 'Info.plist'), 'utf8');
        const executableName = infoPlist.match(
            /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/
        )?.[1];
        if (executableName) {
            const candidate = path.resolve(macosDirectory, executableName);
            if (path.dirname(candidate) === macosDirectory && fs.existsSync(candidate)) {
                return candidate;
            }
        }
    } catch {
        // Fall back to the path returned by @vscode/test-electron.
    }

    return vscodeExecutablePath;
}