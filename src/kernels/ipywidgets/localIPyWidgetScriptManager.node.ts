// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { Memento, Uri } from 'vscode';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { IExtensionContext } from '../../platform/common/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../telemetry/helpers';
import { IKernel } from '../types';
import { BaseIPyWidgetScriptManager } from './baseIPyWidgetScriptManager';
import { IIPyWidgetScriptManager, INbExtensionsPathProvider } from './types';
import { traceError, traceInfo } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths.node';

/**
 * IPyWidgets have a single entry point in requirejs as follows:
 * - beakerx -> nbextensions/beakerx-widget/some-index.js
 * When rendering the widget, requirejs will end up loading the some-index.js in the renderer.
 * However, in some cases the file some-index.js will end up loading more static resources such as png files or other js files.
 * And some of these are loaded with the http request = `<document.body['data-base-url'] + 'nbextensions/beakerx-widget/save.png'`
 * For this to work:
 * - We need to ensure the `data-base-url` attribute is added to the body element, & that's retrieved via getBaseUrl
 * - We need to ensure all of the folders & files from `<python env>/share/jupyter/nbextensions` are copied into a location
 * in the extension folder so that it can be accessed via the webview.
 */
export class LocalIPyWidgetScriptManager extends BaseIPyWidgetScriptManager implements IIPyWidgetScriptManager {
    private nbExtensionsParentPathPromise?: Promise<Uri | undefined>;
    constructor(
        kernel: IKernel,
        private readonly fs: IFileSystemNode,
        private readonly nbExtensionsPathProvider: INbExtensionsPathProvider,
        private readonly context: IExtensionContext,
        private readonly globalMemento: Memento
    ) {
        super(kernel);
    }
    public getBaseUrl() {
        return this.getNbExtensionsParentPath();
    }
    protected override onKernelRestarted(): void {
        this.nbExtensionsParentPathPromise = undefined;
    }
    protected async getNbExtensionsParentPath(): Promise<Uri | undefined> {
        if (!this.nbExtensionsParentPathPromise) {
            this.nbExtensionsParentPathPromise = this.getNbExtensionsParentPathImpl();
        }
        return this.nbExtensionsParentPathPromise;
    }
    protected async getWidgetEntryPoints(): Promise<{ uri: Uri; widgetFolderName: string }[]> {
        const [sourceNbExtensionsPath] = await Promise.all([
            this.nbExtensionsPathProvider.getNbExtensionsParentPath(this.kernel)
        ]);
        if (!sourceNbExtensionsPath) {
            return [];
        }

        // Get all of the widget entry points, which would be of the form `nbextensions/<widget folder>/extension.js`
        const nbExtensionsFolder = Uri.joinPath(sourceNbExtensionsPath, 'nbextensions');
        const extensions = await this.fs.searchLocal('*/extension.js', nbExtensionsFolder.fsPath, true);
        return extensions.map((entry) => ({
            uri: Uri.joinPath(nbExtensionsFolder, entry),
            widgetFolderName: path.dirname(entry)
        }));
    }
    protected getWidgetScriptSource(source: Uri): Promise<string> {
        return this.fs.readLocalFile(source.fsPath);
    }
    private async getNbExtensionsParentPathImpl(): Promise<Uri | undefined> {
        const sourceNbExtensionsParentPath = this.nbExtensionsPathProvider.getNbExtensionsParentPath(this.kernel);
        if (!sourceNbExtensionsParentPath) {
            traceError(`Failed to get nbextensions parent path for ${this.kernel.kernelConnectionMetadata.id}`);
            return;
        }
        const nbextensionsPath = path.join(sourceNbExtensionsParentPath.fsPath, 'nbextensions');
        try {
            const stopWatch = new StopWatch();
            const kernelHash = getTelemetrySafeHashedString(this.kernel.kernelConnectionMetadata.id);
            const baseUrl = Uri.joinPath(this.context.extensionUri, 'tmp', 'scripts', kernelHash, 'jupyter');
            const filesPromise = this.fs.searchLocal('**/*.*', nbextensionsPath).catch((ex) => {
                // Handle errors an ensure we don't crash the rest of the code just because we couldn't search for files.
                traceError(`Failed to search for files in ${nbextensionsPath}`, ex);
                return [];
            });
            // If we have previously copied the files, and the file count is the same, then don't overwrite them.
            const previouslyCopiedFileCount = this.globalMemento.get<number>(this.getMementoKey(), 0);
            if (previouslyCopiedFileCount > 0) {
                const files = await filesPromise;
                if (files.length === previouslyCopiedFileCount) {
                    traceInfo(
                        `Re-using previous nbextension folder ${getDisplayPath(baseUrl)} for kernel ${
                            this.kernel.kernelConnectionMetadata.id
                        }, completed in ${stopWatch.elapsedTime}ms.`
                    );
                    return baseUrl;
                }
            }
            const targetNbExtensions = Uri.joinPath(baseUrl, 'nbextensions');
            await this.fs.ensureLocalDir(targetNbExtensions.fsPath);
            await this.fs.copyLocal(nbextensionsPath, targetNbExtensions.fsPath, { overwrite: true });
            const files = await filesPromise;
            await this.globalMemento.update(this.getMementoKey(), files.length);
            sendTelemetryEvent(Telemetry.IPyWidgetNbExtensionCopyTime, stopWatch.elapsedTime);
            traceInfo(
                `Copied ${files.length} nbextension files for kernel ${
                    this.kernel.kernelConnectionMetadata.id
                } from ${getDisplayPath(sourceNbExtensionsParentPath)} to ${getDisplayPath(baseUrl)} in ${
                    stopWatch.elapsedTime
                }ms.`
            );
            return baseUrl;
        } catch (ex) {
            traceError(
                `Failed to copy nbextensions for kernel ${this.kernel.kernelConnectionMetadata.id} from ${nbextensionsPath}`,
                ex
            );
            sendTelemetryEvent(Telemetry.IPyWidgetNbExtensionCopyTime, undefined, undefined, ex);
            throw ex;
        }
    }
    private getMementoKey() {
        return `nbExtensions-copy-${this.kernel.kernelConnectionMetadata.id}`;
    }
}
