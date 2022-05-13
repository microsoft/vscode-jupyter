import { EventEmitter, Event, Uri } from 'vscode';
import { ILocalResourceUriConverter } from './types';
import * as path from '../../platform/vscode-path/path';
import { inject, injectable } from 'inversify';
import { IFileSystem } from '../../platform/common/platform/types.node';
import { FileSystem } from '../../platform/common/platform/fileSystem.node';
import { IExtensionContext } from '../../platform/common/types';
import { getOSType, OSType } from '../../platform/common/utils/platform';
import { sha256 } from 'hash.js';
import { createDeferred, Deferred } from '../../platform/common/utils/async';
import { traceInfo, traceError } from '../../platform/logging';
import { getComparisonKey } from '../../platform/vscode-path/resources';
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const sanitize = require('sanitize-filename');

@injectable()
export class ScriptUriConverter implements ILocalResourceUriConverter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get requestUri(): Event<Uri> {
        return this.requestUriEmitter.event;
    }
    public get rootScriptFolder(): Uri {
        return Uri.file(this._rootScriptFolder);
    }
    private readonly _rootScriptFolder: string;
    private readonly createTargetWidgetScriptsFolder: Promise<string>;
    private readonly targetWidgetScriptsFolder: string;
    private readonly resourcesMappedToExtensionFolder = new Map<string, Promise<Uri>>();
    private readonly uriConversionPromises = new Map<string, Deferred<Uri>>();
    private requestUriEmitter = new EventEmitter<Uri>();

    /**
     * This method is called to convert a Uri to a format such that it can be used in a webview.
     * WebViews only allow files that are part of extension and the same directory where notebook lives.
     * To ensure widgets can find the js files, we copy the script file to a into the extensionr folder  `tmp/nbextensions`.
     * (storing files in `tmp/nbextensions` is relatively safe as this folder gets deleted when ever a user updates to a new version of VSC).
     * Hence we need to copy for every version of the extension.
     * Copying into global workspace folder would also work, but over time this folder size could grow (in an unmanaged way).
     */
    public async asWebviewUri(localResource: Uri): Promise<Uri> {
        // Make a copy of the local file if not already in the correct location
        if (!this.isInScriptPath(localResource.fsPath)) {
            if (!this.resourcesMappedToExtensionFolder.has(localResource.fsPath)) {
                const deferred = createDeferred<Uri>();
                this.resourcesMappedToExtensionFolder.set(localResource.fsPath, deferred.promise);
                try {
                    // Create a file name such that it will be unique and consistent across VSC reloads.
                    // Only if original file has been modified should we create a new copy of the sam file.
                    const fileHash: string = await this.fs.getFileHash(localResource.fsPath);
                    const uniqueFileName = sanitize(
                        sha256().update(`${localResource.fsPath}${fileHash}`).digest('hex')
                    );
                    const targetFolder = await this.createTargetWidgetScriptsFolder;
                    const mappedResource = Uri.file(
                        path.join(targetFolder, `${uniqueFileName}${path.basename(localResource.fsPath)}`)
                    );
                    if (!(await this.fs.localFileExists(mappedResource.fsPath))) {
                        await this.fs.copyLocal(localResource.fsPath, mappedResource.fsPath);
                    }
                    traceInfo(`Widget Script file ${localResource.fsPath} mapped to ${mappedResource.fsPath}`);
                    deferred.resolve(mappedResource);
                } catch (ex) {
                    traceError(`Failed to map widget Script file ${localResource.fsPath}`);
                    deferred.reject(ex);
                }
            }
            localResource = await this.resourcesMappedToExtensionFolder.get(localResource.fsPath)!;
        }
        const key = getComparisonKey(localResource);
        if (!this.uriConversionPromises.has(key)) {
            this.uriConversionPromises.set(key, createDeferred<Uri>());
            // Send a request for the translation.
            this.requestUriEmitter.fire(localResource);
        }
        return this.uriConversionPromises.get(key)!.promise;
    }

    public resolveUri(request: Uri, result: Uri): void {
        const key = getComparisonKey(request);
        if (this.uriConversionPromises.get(key)) {
            this.uriConversionPromises.get(key)!.resolve(result);
        }
    }

    constructor(
        @inject(IFileSystem) private readonly fs: FileSystem,
        @inject(IExtensionContext) extensionContext: IExtensionContext
    ) {
        this._rootScriptFolder = path.join(extensionContext.extensionPath, 'tmp', 'scripts');
        this.targetWidgetScriptsFolder = path.join(this._rootScriptFolder, 'nbextensions');
        this.createTargetWidgetScriptsFolder = this.fs
            .localDirectoryExists(this.targetWidgetScriptsFolder)
            .then(async (exists) => {
                if (!exists) {
                    await this.fs.createLocalDirectory(this.targetWidgetScriptsFolder);
                }
                return this.targetWidgetScriptsFolder;
            });
    }

    private isInScriptPath(filePath: string) {
        const scriptPath = path.normalize(this._rootScriptFolder);
        filePath = path.normalize(filePath);
        if (getOSType() === OSType.Windows) {
            return filePath.toUpperCase().startsWith(scriptPath.toUpperCase());
        } else {
            return filePath.startsWith(scriptPath);
        }
    }
}
