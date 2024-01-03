// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IKernel } from '../../../../kernels/types';
import {
    IIPyWidgetScriptManagerFactory,
    ILocalResourceUriConverter,
    IWidgetScriptSourceProvider,
    WidgetScriptSource
} from '../types';

/**
 * Widget scripts are found in <python folder>/share/jupyter/nbextensions.
 * Here's an example:
 * <python folder>/share/jupyter/nbextensions/k3d/index.js
 * <python folder>/share/jupyter/nbextensions/nglview/index.js
 * <python folder>/share/jupyter/nbextensions/bqplot/index.js
 */
export class LocalWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    id: 'local';
    constructor(
        private readonly kernel: IKernel,
        private readonly localResourceUriConverter: ILocalResourceUriConverter,
        private readonly scriptManagerFactory: IIPyWidgetScriptManagerFactory
    ) {}
    public async getWidgetScriptSource(moduleName: string): Promise<Readonly<WidgetScriptSource>> {
        const sources = await this.getWidgetScriptSources();
        const found = sources.find((item) => item.moduleName.toLowerCase() === moduleName.toLowerCase());
        return found || { moduleName };
    }
    public dispose() {
        // Noop.
    }
    public async getWidgetScriptSources(): Promise<Readonly<WidgetScriptSource[]>> {
        const scriptManager = this.scriptManagerFactory.getOrCreate(this.kernel);
        const widgetModuleMappings = await scriptManager.getWidgetModuleMappings();
        if (widgetModuleMappings && Object.keys(widgetModuleMappings).length) {
            const sources = await Promise.all(
                Object.keys(widgetModuleMappings).map(async (moduleName) => {
                    const scriptUri = (
                        await this.localResourceUriConverter.asWebviewUri(widgetModuleMappings[moduleName])
                    ).toString();
                    return <WidgetScriptSource>{ moduleName, scriptUri, source: 'local' };
                })
            );
            return sources;
        }
        return [];
    }
    public async getBaseUrl() {
        const scriptManager = this.scriptManagerFactory.getOrCreate(this.kernel);
        if (!scriptManager.getBaseUrl) {
            return;
        }
        const baseUrl = await scriptManager.getBaseUrl();
        if (!baseUrl) {
            return;
        }
        return this.localResourceUriConverter.asWebviewUri(baseUrl);
    }
}
