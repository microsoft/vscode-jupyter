// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { extensions, type Extension } from 'vscode';
import { IDisposableRegistry, IExtensions } from '../types';
import { DataScience } from '../utils/localize';
import { parseStack } from '../../errors';
import { JVSC_EXTENSION_ID, unknownExtensionId } from '../constants';
import { traceError } from '../../logging';

/**
 * Provides functions for tracking the list of extensions that VS code has installed (besides our own)
 */
@injectable()
export class Extensions implements IExtensions {
    private _extensions: readonly Extension<unknown>[] = [];
    private get extensions() {
        return this._extensions;
    }
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push(extensions.onDidChange(() => (this._extensions = extensions.all)));
        this._extensions = extensions.all;
    }
    public determineExtensionFromCallStack(stack?: string): { extensionId: string; displayName: string } {
        stack = stack || new Error().stack;
        try {
            if (stack) {
                const jupyterExtRoot = extensions
                    .getExtension(JVSC_EXTENSION_ID)!
                    .extensionUri.toString()
                    .toLowerCase();
                const frames = stack
                    .split('\n')
                    .map((f) => {
                        const result = /\((.*)\)/.exec(f);
                        const filenameWithPositions = result ? result[1] : undefined;
                        try {
                            const filename = /\((.*)\:\d*\:\d*\)/.exec(f);
                            if (!filename) {
                                return filenameWithPositions;
                            }
                            if (!filenameWithPositions) {
                                return filename[1];
                            }
                            if (filenameWithPositions.startsWith(filename[1])) {
                                return filename[1];
                            }
                        } catch {
                            //
                        }
                        return filenameWithPositions;
                    })
                    .filter((item) => item && !item.toLowerCase().startsWith(jupyterExtRoot)) as string[];
                const folderParts = jupyterExtRoot.split(/[\\/]/);
                const indexOfJupyterExtFolder = folderParts.findIndex((item) => item.startsWith(JVSC_EXTENSION_ID));
                const extensionFolderName =
                    indexOfJupyterExtFolder === -1 ? undefined : folderParts[indexOfJupyterExtFolder - 1];

                parseStack(new Error('Ex')).forEach((item) => {
                    const fileName = item.getFileName();
                    if (fileName && !fileName.toLowerCase().startsWith(jupyterExtRoot)) {
                        frames.push(fileName);
                    }
                });
                for (const frame of frames) {
                    const matchingExt = this.extensions.find(
                        (ext) =>
                            ext.id !== JVSC_EXTENSION_ID &&
                            (frame.toLowerCase().startsWith(ext.extensionUri.fsPath.toLowerCase()) ||
                                frame.toLowerCase().startsWith(ext.extensionUri.path.toLowerCase()))
                    );
                    if (matchingExt) {
                        return { extensionId: matchingExt.id, displayName: matchingExt.packageJSON.displayName };
                    }
                }
                // We're just after the extensions folder.
                let extensionPathFromFrames = frames.find((frame) => frame.includes(JVSC_EXTENSION_ID));
                if (extensionPathFromFrames) {
                    extensionPathFromFrames = extensionPathFromFrames.substring(
                        0,
                        extensionPathFromFrames.indexOf(JVSC_EXTENSION_ID) - 1
                    );
                }

                if (!extensionFolderName || !extensionPathFromFrames) {
                    return { extensionId: unknownExtensionId, displayName: DataScience.unknownPackage };
                }
                // Possible Jupyter extension root is ~/.vscode-server-insiders/extensions/ms-toolsai.jupyter-2024.3.0
                // But call stack has paths such as ~/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0/out/main.js
                for (const frame of frames.filter((f) => {
                    return f.startsWith(extensionPathFromFrames!) && !f.includes(JVSC_EXTENSION_ID);
                })) {
                    let extensionIdInFrame = frame
                        .substring(extensionPathFromFrames.length)
                        .substring(1)
                        .split(/[\\/]/)[0];
                    if (extensionIdInFrame.includes('-')) {
                        extensionIdInFrame = extensionIdInFrame.substring(0, extensionIdInFrame.lastIndexOf('-'));
                    }
                    const matchingExt = this.extensions.find((ext) => ext.id === extensionIdInFrame);
                    if (matchingExt) {
                        return { extensionId: matchingExt.id, displayName: matchingExt.packageJSON.displayName };
                    }
                }
            }
            traceError(`Unable to determine the caller of the extension API for trace stack.`, stack);
            return { extensionId: unknownExtensionId, displayName: DataScience.unknownPackage };
        } catch (ex) {
            traceError(`Unable to determine the caller of the extension API for trace stack.`, stack);
            traceError(`Failure error`, ex);
            return { extensionId: unknownExtensionId, displayName: DataScience.unknownPackage };
        }
    }
}
