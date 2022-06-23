import { EventEmitter, Event, Uri, FileType } from 'vscode';
import { ILocalResourceUriConverter } from './types';
import * as uriPath from '../../platform/vscode-path/resources';
import { inject, injectable } from 'inversify';
import { IFileSystem } from '../../platform/common/platform/types';
import { IExtensionContext } from '../../platform/common/types';
import { sha256 } from 'hash.js';
import { createDeferred, Deferred } from '../../platform/common/utils/async';
import { traceInfo, traceError } from '../../platform/logging';
import { getComparisonKey } from '../../platform/vscode-path/resources';
import { getFilePath } from '../../platform/common/platform/fs-paths';
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const sanitize = require('sanitize-filename');

@injectable()
export class ScriptUriConverter implements ILocalResourceUriConverter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get requestUri(): Event<Uri> {
        return this.requestUriEmitter.event;
    }
    public get rootScriptFolder(): Uri {
        return this._rootScriptFolder;
    }
    private readonly _rootScriptFolder: Uri;
    private readonly createTargetWidgetScriptsFolder: Promise<Uri>;
    private readonly targetWidgetScriptsFolder: Uri;
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
        if (!this.isInScriptPath(localResource)) {
            const key = getComparisonKey(localResource);
            if (!this.resourcesMappedToExtensionFolder.has(key)) {
                const deferred = createDeferred<Uri>();
                this.resourcesMappedToExtensionFolder.set(key, deferred.promise);
                try {
                    // Create a file name such that it will be unique and consistent across VSC reloads.
                    // Only if original file has been modified should we create a new copy of the same file.
                    const fileHash: string = await this.fs.getFileHash(localResource);
                    const uniqueFileName = sanitize(
                        sha256()
                            .update(`${getFilePath(localResource)}${fileHash}`)
                            .digest('hex')
                    );
                    const targetFolder = await this.createTargetWidgetScriptsFolder;
                    const mappedResource = uriPath.joinPath(
                        targetFolder,
                        `${uniqueFileName}${uriPath.basename(localResource)}`
                    );
                    if (!(await this.fs.exists(mappedResource))) {
                        await this.fs.copy(localResource, mappedResource);
                    }
                    traceInfo(
                        `Widget Script file ${getFilePath(localResource)} mapped to ${getFilePath(mappedResource)}`
                    );
                    deferred.resolve(mappedResource);
                } catch (ex) {
                    traceError(`Failed to map widget Script file ${getFilePath(localResource)}`);
                    deferred.reject(ex);
                }
            }
            localResource = await this.resourcesMappedToExtensionFolder.get(key)!;
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
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) extensionContext: IExtensionContext
    ) {
        // Scripts have to be written somewhere we can:
        // - Write to disk
        // - Convert into a URI that can be loaded
        // For now only extensionUri is convertable (notebook code adds this path as a localResourceRoot)
        // but that doesn't work in web because it's readonly.
        // This is pending: https://github.com/microsoft/vscode/issues/149868
        this._rootScriptFolder = uriPath.joinPath(extensionContext.extensionUri, 'tmp', 'scripts');
        this.targetWidgetScriptsFolder = uriPath.joinPath(this._rootScriptFolder, 'nbextensions');
        this.createTargetWidgetScriptsFolder = this.fs
            .exists(this.targetWidgetScriptsFolder, FileType.Directory)
            .then(async (exists) => {
                if (!exists) {
                    await this.fs.createDirectory(this.targetWidgetScriptsFolder);
                }
                return this.targetWidgetScriptsFolder;
            });
    }

    private isInScriptPath(uri: Uri) {
        return uriPath.isEqualOrParent(uri, this._rootScriptFolder, false);
    }
}
