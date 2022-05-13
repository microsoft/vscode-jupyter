// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from '../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { traceError } from '../../platform/logging';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { IPythonExecutionFactory } from '../../platform/common/process/types.node';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { captureTelemetry } from '../../telemetry';
import { Telemetry } from '../../webviews/webview-side/common/constants';
import {
    getInterpreterFromKernelConnectionMetadata,
    isPythonKernelConnection,
    getKernelPathFromKernelConnection
} from '../helpers';
import { IKernel } from '../types';
import { ILocalResourceUriConverter, IWidgetScriptSourceProvider, WidgetScriptSource } from './types';

/**
 * Widget scripts are found in <python folder>/share/jupyter/nbextensions.
 * Here's an example:
 * <python folder>/share/jupyter/nbextensions/k3d/index.js
 * <python folder>/share/jupyter/nbextensions/nglview/index.js
 * <python folder>/share/jupyter/nbextensions/bqplot/index.js
 */
export class LocalWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    private cachedWidgetScripts?: Promise<WidgetScriptSource[]>;
    constructor(
        private readonly kernel: IKernel,
        private readonly localResourceUriConverter: ILocalResourceUriConverter,
        private readonly fs: IFileSystemNode,
        private readonly interpreterService: IInterpreterService,
        private readonly factory: IPythonExecutionFactory
    ) { }
    public async getWidgetScriptSource(moduleName: string): Promise<Readonly<WidgetScriptSource>> {
        const sources = await this.getWidgetScriptSources();
        const found = sources.find((item) => item.moduleName.toLowerCase() === moduleName.toLowerCase());
        return found || { moduleName };
    }
    public dispose() {
        // Noop.
    }
    public async getWidgetScriptSources(ignoreCache?: boolean): Promise<Readonly<WidgetScriptSource[]>> {
        if (!ignoreCache && this.cachedWidgetScripts) {
            return this.cachedWidgetScripts;
        }
        return (this.cachedWidgetScripts = this.getWidgetScriptSourcesWithoutCache());
    }
    @captureTelemetry(Telemetry.DiscoverIPyWidgetNamesLocalPerf)
    private async getWidgetScriptSourcesWithoutCache(): Promise<WidgetScriptSource[]> {
        const sysPrefix = await this.getSysPrefixOfKernel();
        if (!sysPrefix) {
            return [];
        }

        const nbextensionsPath = path.join(sysPrefix, 'share', 'jupyter', 'nbextensions');
        // Search only one level deep, hence `*/index.js`.
        const [files, extensionFiles] = await Promise.all([
            this.fs.searchLocal(`*${path.sep}index.js`, nbextensionsPath),
            this.fs.searchLocal(`*${path.sep}extension.js`, nbextensionsPath)
        ]);

        // Do not include 'jupyter-js-widgets' as this has been replaced with '@jupyter-widgets/base'.
        // & on the UI side we re-map this to '@jupyter-widgets/base'.
        const validModules = new Set<string>(['jupyter-js-widgets']);
        const validFiles = files.filter((file) => {
            // Would be of the form `<widget module>/index.js`
            const parts = file.split('/'); // On windows this uses the unix separator too.
            if (parts.length !== 2) {
                traceError('Incorrect file found when searching for nnbextension entrypoints');
                return false;
            }
            validModules.add(parts[0]);
            return true;
        });

        // Some widgets require additional files to be loaded (i.e they have other dependencies).
        // The dependencies are specified in the extension.js file of other directories.
        // E.g. widget a would be in folder nbextensions/widgetA/index.js & index.js would have code such as `define(['widgetB'], function(widgetB) {});`
        // Jupyter lab/notebooks loads all such widgets, we too should try to load them all.
        extensionFiles.forEach((file) => {
            // Would be of the form `<widget module>/extension.js`
            const parts = file.split('/'); // On windows this uses the unix separator too.
            const moduleName = parts[0];
            if (validModules.has(moduleName)) {
                return;
            }
            validModules.add(parts[0]);
            if (parts.length !== 2) {
                return;
            }
            validFiles.push(file);
        });

        const mappedFiles = validFiles.map(async (file) => {
            // Would be of the form `<widget module>/index.js`
            const parts = file.split('/');
            const moduleName = parts[0];

            const fileUri = Uri.file(path.join(nbextensionsPath, file));
            const scriptUri = (await this.localResourceUriConverter.asWebviewUri(fileUri)).toString();
            return <WidgetScriptSource>{ moduleName, scriptUri, source: 'local' };
        });
        return Promise.all(mappedFiles);
    }
    private async getSysPrefixOfKernel() {
        const kernelConnectionMetadata = this.kernel.kernelConnectionMetadata;
        if (!kernelConnectionMetadata) {
            return;
        }
        const interpreter = getInterpreterFromKernelConnectionMetadata(kernelConnectionMetadata);
        if (interpreter?.sysPrefix) {
            return interpreter?.sysPrefix;
        }
        if (!isPythonKernelConnection(kernelConnectionMetadata)) {
            return;
        }
        const interpreterOrKernelPath = interpreter?.uri || getKernelPathFromKernelConnection(kernelConnectionMetadata);
        if (!interpreterOrKernelPath) {
            return;
        }
        const interpreterInfo = await this.interpreterService
            .getInterpreterDetails(interpreterOrKernelPath)
            .catch(
                traceError.bind(`Failed to get interpreter details for Kernel/Interpreter ${interpreterOrKernelPath}`)
            );

        if (interpreterInfo && !interpreterInfo.sysPrefix) {
            const pythonService = await this.factory.createActivatedEnvironment({ interpreter: interpreterInfo });
            const info = await pythonService.getInterpreterInformation();
            return info?.sysPrefix;
        }
        if (interpreterInfo) {
            return interpreterInfo?.sysPrefix;
        }
    }
}
