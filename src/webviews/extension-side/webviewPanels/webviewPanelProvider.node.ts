// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IDisposableRegistry, IExtensionContext } from '../../../platform/common/types';
import { IWebviewPanel, IWebviewPanelOptions, IWebviewPanelProvider } from '../../../platform/common/application/types';
import { WebviewPanel } from './webviewPanel.node';

@injectable()
export class WebviewPanelProvider implements IWebviewPanelProvider {
    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async create(options: IWebviewPanelOptions): Promise<IWebviewPanel> {
        // Allow loading resources from the `<extension folder>/tmp` folder when in webiviews.
        // Used by widgets to place files that are not otherwise accessible.
        const additionalRootPaths = [Uri.file(path.join(this.context.extensionPath, 'tmp'))];
        if (Array.isArray(options.additionalPaths)) {
            additionalRootPaths.push(...options.additionalPaths.map((item) => Uri.file(item)));
        }
        return new WebviewPanel(this.fs, this.disposableRegistry, options, additionalRootPaths);
    }
}
