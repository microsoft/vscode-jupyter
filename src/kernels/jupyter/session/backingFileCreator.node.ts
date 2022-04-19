// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { ContentsManager } from '@jupyterlab/services';
import * as path from '../../../platform/vscode-path/path';
import * as uuid from 'uuid/v4';
import { Resource } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { KernelConnectionMetadata, IJupyterConnection } from '../../types';
import { IFileSystem } from '../../../platform/common/platform/types.node';
import { injectable, inject } from 'inversify';
import { BaseBackingFileCreator } from './backingFileCreator.base';
import { Uri } from 'vscode';

@injectable()
export class BackingFileCreator extends BaseBackingFileCreator {
    constructor(@inject(IFileSystem) private readonly fs: IFileSystem) {
        super();
    }
    public override async createBackingFile(
        resource: Resource,
        workingDirectory: Uri,
        kernel: KernelConnectionMetadata,
        connInfo: IJupyterConnection,
        contentsManager: ContentsManager
    ): Promise<{ dispose: () => Promise<unknown>; filePath: string } | undefined> {
        if (connInfo.localLaunch) {
            const tempFile = await this.fs.createTemporaryLocalFile('.ipynb');
            const tempDirectory = path.join(
                path.dirname(tempFile.filePath),
                path.basename(tempFile.filePath, '.ipynb')
            );
            await tempFile.dispose();
            // This way we ensure all checkpoints are in a unique directory and will not conflict.
            await this.fs.ensureLocalDir(tempDirectory);

            const newName = resource
                ? `${path.basename(resource.fsPath, '.ipynb')}.ipynb`
                : `${DataScience.defaultNotebookName()}-${uuid()}.ipynb`;

            const filePath = path.join(tempDirectory, newName);
            return {
                filePath,
                dispose: () => this.fs.deleteLocalFile(filePath)
            };
        }

        return super.createBackingFile(resource, workingDirectory, kernel, connInfo, contentsManager);
    }
}
