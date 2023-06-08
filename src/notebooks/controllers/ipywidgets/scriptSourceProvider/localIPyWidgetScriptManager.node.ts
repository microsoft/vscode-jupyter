// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { IFileSystemNode } from '../../../../platform/common/platform/types.node';
import { IExtensionContext } from '../../../../platform/common/types';
import { StopWatch } from '../../../../platform/common/utils/stopWatch';
import { sendTelemetryEvent, Telemetry } from '../../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../../platform/telemetry/helpers';
import { IKernel } from '../../../../kernels/types';
import { BaseIPyWidgetScriptManager } from './baseIPyWidgetScriptManager';
import { IIPyWidgetScriptManager, INbExtensionsPathProvider } from '../types';
import { JupyterPaths } from '../../../../kernels/raw/finder/jupyterPaths.node';

type KernelConnectionId = string;
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
    /**
     * Copy once per session of VS Code or until user restarts the kernel.
     */
    private sourceNbExtensionsPath?: Uri;
    private overwriteExistingFiles = true;
    static nbExtensionsCopiedKernelConnectionList = new Set<KernelConnectionId>();
    private nbExtensionsParentPath?: Promise<Uri | undefined>;
    constructor(
        kernel: IKernel,
        private readonly fs: IFileSystemNode,
        private readonly nbExtensionsPathProvider: INbExtensionsPathProvider,
        private readonly context: IExtensionContext,
        private readonly jupyterPaths: JupyterPaths
    ) {
        super(kernel);
        // When re-loading VS Code, always overwrite the files.
        this.overwriteExistingFiles = !LocalIPyWidgetScriptManager.nbExtensionsCopiedKernelConnectionList.has(
            kernel.kernelConnectionMetadata.id
        );
    }
    public getBaseUrl() {
        return this.getNbExtensionsParentPath();
    }
    protected override onKernelRestarted(): void {
        this.nbExtensionsParentPath = undefined;
        // Possible there are new versions of nbExtensions that are not yet copied.
        // E.g. user installs a package and restarts the kernel.
        this.overwriteExistingFiles = true;
        super.onKernelRestarted();
    }
    protected async getNbExtensionsParentPath(): Promise<Uri | undefined> {
        if (!this.nbExtensionsParentPath) {
            this.nbExtensionsParentPath = this.getNbExtensionsParentPathImpl();
        }
        return this.nbExtensionsParentPath;
    }
    private async getNbExtensionsParentPathImpl(): Promise<Uri | undefined> {
        let overwrite = this.overwriteExistingFiles;

        try {
            const stopWatch = new StopWatch();
            this.sourceNbExtensionsPath = await this.nbExtensionsPathProvider.getNbExtensionsParentPath(this.kernel);
            if (!this.sourceNbExtensionsPath) {
                return;
            }
            const kernelHash = await getTelemetrySafeHashedString(this.kernel.kernelConnectionMetadata.id);
            const baseUrl = Uri.joinPath(this.context.extensionUri, 'temp', 'scripts', kernelHash, 'jupyter');

            const targetNbExtensions = Uri.joinPath(baseUrl, 'nbextensions');
            const [jupyterDataDirectories] = await Promise.all([
                this.jupyterPaths.getDataDirs({
                    resource: this.kernel.resourceUri,
                    interpreter: this.kernel.kernelConnectionMetadata.interpreter
                }),
                this.fs.createDirectory(targetNbExtensions)
            ]);
            const nbExtensionFolders = jupyterDataDirectories.map((dataDir) => Uri.joinPath(dataDir, 'nbextensions'));
            // The nbextensions folder is sorted in order of priority.
            // Hence when copying, copy the lowest priority nbextensions folder first.
            // This way contents get overwritten with contents of highest priority (thereby adhering to the priority).
            nbExtensionFolders.reverse();
            for (const nbExtensionFolder of nbExtensionFolders) {
                if (await this.fs.exists(nbExtensionFolder)) {
                    await this.fs.copy(nbExtensionFolder, targetNbExtensions, { overwrite });
                }
            }
            // If we've copied once, then next time, don't overwrite.
            this.overwriteExistingFiles = false;
            LocalIPyWidgetScriptManager.nbExtensionsCopiedKernelConnectionList.add(
                this.kernel.kernelConnectionMetadata.id
            );
            sendTelemetryEvent(Telemetry.IPyWidgetNbExtensionCopyTime, { duration: stopWatch.elapsedTime });
            return baseUrl;
        } catch (ex) {
            sendTelemetryEvent(Telemetry.IPyWidgetNbExtensionCopyTime, undefined, undefined, ex);
            throw ex;
        }
    }
    protected async getWidgetEntryPoints(): Promise<{ uri: Uri; widgetFolderName: string }[]> {
        const nbExtensionsParentPath = await this.getNbExtensionsParentPath();
        if (!nbExtensionsParentPath) {
            return [];
        }

        // Get all of the widget entry points, which would be of the form `nbextensions/<widget folder>/extension.js`
        const nbExtensionsFolder = Uri.joinPath(nbExtensionsParentPath, 'nbextensions');
        const extensions = await this.fs.searchLocal('*/extension.js', nbExtensionsFolder.fsPath, true);
        return extensions.map((entry) => ({
            uri: Uri.joinPath(nbExtensionsFolder, entry),
            widgetFolderName: path.dirname(entry)
        }));
    }
    protected getWidgetScriptSource(source: Uri): Promise<string> {
        return this.fs.readFile(source);
    }
}
