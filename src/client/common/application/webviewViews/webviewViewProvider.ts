// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { WebviewView as vscodeWebviewView } from 'vscode';
import { IFileSystem } from '../../platform/types';
import { IDisposableRegistry, IExtensionContext } from '../../types';
import { IWebviewView, IWebviewViewOptions, IWebviewViewProvider } from '../types';
import { WebviewView } from './webviewView';

@injectable()
export class WebviewViewProvider implements IWebviewViewProvider {
    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    // tslint:disable-next-line:no-any
    public async create(options: IWebviewViewOptions, codeWebview: vscodeWebviewView): Promise<IWebviewView> {
        return new WebviewView(this.fs, this.disposableRegistry, options, codeWebview);
    }
}
