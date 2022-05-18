// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IWidgetScriptSourceProvider, WidgetScriptSource } from './types';

/**
 * When using a remote jupyter connection the widget scripts are accessible over
 * `<remote url>/nbextensions/moduleName/index`
 */
export class RemoteWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    public static validUrls = new Map<string, boolean>();
    constructor(private readonly baseUrl: string) {}
    public dispose() {
        // Noop.
    }
    public async getWidgetScriptSource(moduleName: string, _moduleVersion: string): Promise<WidgetScriptSource> {
        const scriptUri = `${this.baseUrl}nbextensions/${moduleName}/index.js`;

        // We might check if we can query jupyter for the script URI, but we need the
        // authorization headers. Just always assume it's going to work for now
        return { moduleName, scriptUri, source: 'remote' };
    }
}
