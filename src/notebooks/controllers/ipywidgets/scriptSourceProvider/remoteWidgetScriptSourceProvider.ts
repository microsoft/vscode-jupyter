// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IKernel, RemoteKernelConnectionMetadata } from '../../../../kernels/types';
import {
    IIPyWidgetScriptManager,
    IIPyWidgetScriptManagerFactory,
    IWidgetScriptSourceProvider,
    WidgetScriptSource
} from '../types';

/**
 * When using a remote jupyter connection the widget scripts are accessible over
 * `<remote url>/nbextensions/moduleName/index`
 */
export class RemoteWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    id: 'remote';
    public static validUrls = new Map<string, boolean>();
    private readonly kernelConnection: RemoteKernelConnectionMetadata;
    private readonly scriptManager: IIPyWidgetScriptManager;
    constructor(kernel: IKernel, scriptManagerFactory: IIPyWidgetScriptManagerFactory) {
        if (
            kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel' &&
            kernel.kernelConnectionMetadata.kind !== 'startUsingRemoteKernelSpec'
        ) {
            throw new Error('Invalid usage of this class, can only be used with remtoe kernels');
        }
        this.kernelConnection = kernel.kernelConnectionMetadata;
        this.scriptManager = scriptManagerFactory.getOrCreate(kernel);
    }
    public dispose() {
        // Noop.
    }
    public async getBaseUrl() {
        return Uri.parse(this.kernelConnection.baseUrl);
    }

    public async getWidgetScriptSource(moduleName: string): Promise<Readonly<WidgetScriptSource>> {
        const sources = await this.getWidgetScriptSources();
        const found = sources.find((item) => item.moduleName.toLowerCase() === moduleName.toLowerCase());
        if (!found && moduleName.includes('/')) {
            // Possible moduleName already contains the path to the script.
            // E.g. in the case of the turtle widget, the module name is `nbextensions/mobilechelonianjs/turtlewidget`
            // and all that's required is to load this script from <jupyter baseUrl><moduleName>, which gives us something like `http://xyz:port/nbextensions/mobilechelonianjs/turtlewidget`
            const baseUrl = await this.getBaseUrl();
            return {
                moduleName,
                scriptUri: `${baseUrl.toString()}${moduleName}`,
                source: 'remote'
            };
        }
        return found || { moduleName };
    }
    public async getWidgetScriptSources(): Promise<Readonly<WidgetScriptSource[]>> {
        const widgetModuleMappings = await this.scriptManager.getWidgetModuleMappings();
        if (widgetModuleMappings && Object.keys(widgetModuleMappings).length) {
            const sources = await Promise.all(
                Object.keys(widgetModuleMappings).map(async (moduleName) => {
                    return <WidgetScriptSource>{
                        moduleName,
                        scriptUri: widgetModuleMappings[moduleName].toString(),
                        source: 'remote'
                    };
                })
            );
            return sources;
        }
        return [];
    }
}
