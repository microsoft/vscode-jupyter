// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { IWebviewViewProvider, IWebviewViewOptions, IWebviewView } from '../../../platform/common/application/types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IDisposableRegistry } from '../../../platform/common/types';
import { WebviewView } from './webviewView.node';

@injectable()
export class WebviewViewProvider implements IWebviewViewProvider {
    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async create(options: IWebviewViewOptions): Promise<IWebviewView> {
        return new WebviewView(this.fs, this.disposableRegistry, options);
    }
}
