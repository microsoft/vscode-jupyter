// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { IWebviewViewProvider, IWebviewViewOptions, IWebviewView } from '../../../platform/common/application/types';
import { IFileSystem } from '../../../platform/common/platform/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { WebviewView } from './webviewView.node';

@injectable()
export class WebviewViewProvider implements IWebviewViewProvider {
    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async create(options: IWebviewViewOptions): Promise<IWebviewView> {
        return new WebviewView(this.fs, this.disposableRegistry, options);
    }
}
