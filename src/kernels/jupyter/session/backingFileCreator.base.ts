// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Contents, ContentsManager } from '@jupyterlab/services';
import uuid from 'uuid/v4';
import { traceError } from '../../../platform/logging';
import { Resource } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { jvscIdentifier } from '../../helpers';
import { KernelConnectionMetadata, isLocalConnection, IJupyterConnection } from '../../types';
import { IJupyterBackingFileCreator } from '../types';
import * as urlPath from '../../../platform/vscode-path/resources';
import * as path from '../../../platform/vscode-path/path';
import { Uri } from 'vscode';

function getRemoteIPynbSuffix(): string {
    return `${jvscIdentifier}${uuid()}`;
}

export function generateBackingIPyNbFileName(resource: Resource) {
    // Generate a more descriptive name
    const suffix = `${getRemoteIPynbSuffix()}${uuid()}.ipynb`;
    return resource
        ? `${urlPath.basename(resource, '.ipynb')}${suffix}`
        : `${DataScience.defaultNotebookName}${suffix}`;
}
export class BaseBackingFileCreator implements IJupyterBackingFileCreator {
    public async createBackingFile(
        resource: Resource,
        workingDirectory: Uri,
        kernel: KernelConnectionMetadata,
        connInfo: IJupyterConnection,
        contentsManager: ContentsManager
    ): Promise<{ dispose: () => Promise<unknown>; filePath: string } | undefined> {
        let backingFile: Contents.IModel | undefined = undefined;

        // First make sure the notebook is in the right relative path (jupyter expects a relative path with unix delimiters)
        const relativeDirectory = urlPath.relativePath(connInfo.rootDirectory, workingDirectory)?.replace(/\\/g, '/');

        // However jupyter does not support relative paths outside of the original root.
        const backingFileOptions: Contents.ICreateOptions =
            isLocalConnection(kernel) && relativeDirectory && !relativeDirectory.startsWith('..')
                ? { type: 'notebook', path: relativeDirectory }
                : { type: 'notebook' };

        // Generate a more descriptive name
        const newName = generateBackingIPyNbFileName(resource);

        try {
            // Create a temporary notebook for this session. Each needs a unique name (otherwise we get the same session every time)
            backingFile = await contentsManager.newUntitled(backingFileOptions);
            const backingFileDir = path.dirname(backingFile.path);
            backingFile = await contentsManager.rename(
                backingFile.path,
                backingFileDir.length && backingFileDir !== '.' ? `${backingFileDir}/${newName}` : newName // Note, the docs say the path uses UNIX delimiters.
            );
        } catch (exc) {
            // If it failed for local, try without a relative directory
            if (isLocalConnection(kernel)) {
                try {
                    backingFile = await contentsManager.newUntitled({ type: 'notebook' });
                    const backingFileDir = path.dirname(backingFile.path);
                    backingFile = await contentsManager.rename(
                        backingFile.path,
                        backingFileDir.length && backingFileDir !== '.' ? `${backingFileDir}/${newName}` : newName // Note, the docs say the path uses UNIX delimiters.
                    );
                } catch (e) {}
            } else {
                traceError(`Backing file not supported: ${exc}`);
            }
        }

        if (backingFile) {
            const filePath = backingFile.path;
            return {
                filePath,
                dispose: () => contentsManager.delete(filePath)
            };
        }
    }
}
