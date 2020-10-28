// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Uri } from 'vscode';
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
    public async create(options: IWebviewViewOptions): Promise<IWebviewView> {
        // Allow loading resources from the `<extension folder>/tmp` folder when in webiviews.
        // Used by widgets to place files that are not otherwise accessible.
        //const additionalRootPaths = [Uri.file(path.join(this.context.extensionPath, 'tmp'))];
        //if (Array.isArray(options.additionalPaths)) {
            //additionalRootPaths.push(...options.additionalPaths.map((item) => Uri.file(item)));
        //}
        return new WebviewView(this.fs, this.disposableRegistry, options, );
    }
}
