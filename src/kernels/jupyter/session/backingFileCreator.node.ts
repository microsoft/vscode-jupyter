// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ContentsManager } from '@jupyterlab/services';
import { Resource } from '../../../platform/common/types';
import { KernelConnectionMetadata, IJupyterConnection } from '../../types';
import { injectable } from 'inversify';
import { BaseBackingFileCreator } from './backingFileCreator.base';
import { Uri } from 'vscode';

@injectable()
export class BackingFileCreator extends BaseBackingFileCreator {
    public override async createBackingFile(
        resource: Resource,
        workingDirectory: Uri,
        kernel: KernelConnectionMetadata,
        connInfo: IJupyterConnection,
        contentsManager: ContentsManager
    ): Promise<{ dispose: () => Promise<unknown>; filePath: string } | undefined> {
        // For local we might be able to skip creating it. An alternative was tried
        // with placing it a tmp folder, but that causes jupyter to fail to start.
        return super.createBackingFile(resource, workingDirectory, kernel, connInfo, contentsManager);
    }
}
