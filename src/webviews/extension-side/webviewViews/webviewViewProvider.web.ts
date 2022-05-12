// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { IWebviewViewProvider, IWebviewViewOptions, IWebviewView } from '../../../platform/common/application/types';
import { IDisposableRegistry, IExtensionContext } from '../../../platform/common/types';
import { WebviewView } from './webviewView.web';

@injectable()
export class WebviewViewProvider implements IWebviewViewProvider {
    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    public async create(options: IWebviewViewOptions): Promise<IWebviewView> {
        return new WebviewView(this.disposableRegistry, this.context, options);
    }
}
