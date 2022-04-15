import { EventEmitter, Event, Uri } from 'vscode';
import { ILocalResourceUriConverter } from './types';
import { injectable } from 'inversify';
import { createDeferred, Deferred } from '../../platform/common/utils/async';
import { getComparisonKey } from '../../platform/vscode-path/resources';

@injectable()
export class ScriptUriConverter implements ILocalResourceUriConverter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get requestUri(): Event<Uri> {
        return this.requestUriEmitter.event;
    }
    public get rootScriptFolder(): Uri {
        return Uri.file('');
    }
    private requestUriEmitter = new EventEmitter<Uri>();
    private readonly uriConversionPromises = new Map<string, Deferred<Uri>>();

    /**
     * This method is called to convert a Uri to a format such that it can be used in a webview.
     * WebViews only allow files that are part of extension and the same directory where notebook lives.
     * To ensure widgets can find the js files, we copy the script file to a into the extensionr folder  `tmp/nbextensions`.
     * (storing files in `tmp/nbextensions` is relatively safe as this folder gets deleted when ever a user updates to a new version of VSC).
     * Hence we need to copy for every version of the extension.
     * Copying into global workspace folder would also work, but over time this folder size could grow (in an unmanaged way).
     */
    public async asWebviewUri(localResource: Uri): Promise<Uri> {
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
}
