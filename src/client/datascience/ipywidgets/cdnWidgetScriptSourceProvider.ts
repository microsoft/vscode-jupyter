// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as download from 'download';
import { sha256 } from 'hash.js';
import * as path from 'path';
import { Uri } from 'vscode';
import { traceError, traceInfo, traceInfoIf } from '../../common/logger';
import { IFileSystem, TemporaryFile } from '../../common/platform/types';
import { IConfigurationService, WidgetCDNs } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import { ConsoleForegroundColors } from '../../logging/_global';
import { ILocalResourceUriConverter } from '../types';
import { IWidgetScriptSourceProvider, WidgetScriptSource } from './types';

// Source borrowed from https://github.com/jupyter-widgets/ipywidgets/blob/54941b7a4b54036d089652d91b39f937bde6b6cd/packages/html-manager/src/libembed-amd.ts#L33
const unpgkUrl = 'https://unpkg.com/';
const jsdelivrUrl = 'https://cdn.jsdelivr.net/npm/';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const sanitize = require('sanitize-filename');

function moduleNameToCDNUrl(cdn: string, moduleName: string, moduleVersion: string) {
    let packageName = moduleName;
    let fileName = 'index'; // default filename
    // if a '/' is present, like 'foo/bar', packageName is changed to 'foo', and path to 'bar'
    // We first find the first '/'
    let index = moduleName.indexOf('/');
    if (index !== -1 && moduleName[0] === '@') {
        // if we have a namespace, it's a different story
        // @foo/bar/baz should translate to @foo/bar and baz
        // so we find the 2nd '/'
        index = moduleName.indexOf('/', index + 1);
    }
    if (index !== -1) {
        fileName = moduleName.substr(index + 1);
        packageName = moduleName.substr(0, index);
    }
    if (cdn === jsdelivrUrl) {
        // Js Delivr doesn't support ^ in the version. It needs an exact version
        if (moduleVersion.startsWith('^')) {
            moduleVersion = moduleVersion.slice(1);
        }
        // Js Delivr also needs the .js file on the end.
        if (!fileName.endsWith('.js')) {
            fileName = fileName.concat('.js');
        }
    }
    return `${cdn}${packageName}@${moduleVersion}/dist/${fileName}`;
}

function getCDNPrefix(cdn?: WidgetCDNs): string | undefined {
    switch (cdn) {
        case 'unpkg.com':
            return unpgkUrl;
        case 'jsdelivr.com':
            return jsdelivrUrl;
        default:
            break;
    }
}
/**
 * Widget scripts are found in CDN.
 * Given an widget module name & version, this will attempt to find the Url on a CDN.
 * We'll need to stick to the order of preference prescribed by the user.
 */
export class CDNWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    private get cdnProviders(): readonly WidgetCDNs[] {
        const settings = this.configurationSettings.getSettings(undefined);
        return settings.widgetScriptSources;
    }
    private cache = new Map<string, Promise<WidgetScriptSource>>();
    constructor(
        private readonly configurationSettings: IConfigurationService,
        private readonly localResourceUriConverter: ILocalResourceUriConverter,
        private readonly fs: IFileSystem
    ) {}
    public dispose() {
        this.cache.clear();
    }
    public async getWidgetScriptSource(moduleName: string, moduleVersion: string): Promise<WidgetScriptSource> {
        // First see if we already have it downloaded.
        const key = this.getModuleKey(moduleName, moduleVersion);
        if (!this.cache.get(key)) {
            this.cache.set(key, this.getWidgetScriptSourceImplementation(moduleName, moduleVersion));
        }
        return this.cache.get(key)!;
    }
    private async getWidgetScriptSourceImplementation(
        moduleName: string,
        moduleVersion: string
    ): Promise<WidgetScriptSource> {
        // First see if we already have it downloaded.
        const key = this.getModuleKey(moduleName, moduleVersion);
        const diskPath = path.join(this.localResourceUriConverter.rootScriptFolder.fsPath, key, 'index.js');
        let tempFile: TemporaryFile | undefined;

        // Might be on disk, try there first.
        if (diskPath && (await this.fs.localFileExists(diskPath))) {
            traceInfo(`${ConsoleForegroundColors.Green}Widget Script ${moduleName}#${moduleVersion} found`);
            const scriptUri = (await this.localResourceUriConverter.asWebviewUri(Uri.file(diskPath))).toString();
            return { moduleName, scriptUri, source: 'cdn' };
        }

        // If still not found, download it.
        try {
            traceInfo(`${ConsoleForegroundColors.Green}Widget Script ${moduleName}#${moduleVersion} searching`);
            // Make sure the disk path directory exists. We'll be downloading it to there.
            await this.fs.createLocalDirectory(path.dirname(diskPath));

            // Then get the first one that returns.
            tempFile = await this.downloadFastestCDN(moduleName, moduleVersion);
            if (tempFile) {
                traceInfo(
                    `${ConsoleForegroundColors.Green}Wiget ${moduleName} successfully downloaded to temp file ${tempFile.filePath}`
                );
                traceInfoIf(
                    !!process.env.VSC_JUPYTER_FORCE_LOGGING,
                    `Widget Script downloaded for ${moduleName}:${moduleVersion}, already downloaded ${await this.fs.localFileExists(
                        diskPath
                    )}`
                );
                if (!(await this.fs.localFileExists(diskPath))) {
                    traceInfo(`${ConsoleForegroundColors.Green}Wiget ${moduleName} being copied into ${diskPath}`);
                    // Need to copy from the temporary file to our real file (note: VSC filesystem fails to copy so just use straight file system)
                    await this.fs.copyLocal(tempFile.filePath, diskPath);
                }

                // Now we can generate the script URI so the local converter doesn't try to copy it.
                const scriptUri = (await this.localResourceUriConverter.asWebviewUri(Uri.file(diskPath))).toString();
                traceInfo(
                    `${ConsoleForegroundColors.Green}Wiget ${moduleName} downloaded into ${scriptUri} from cdn (${diskPath})`
                );
                return { moduleName, scriptUri, source: 'cdn' };
            } else {
                return { moduleName };
            }
        } catch (exc) {
            traceError('Error downloading from CDN: ', exc);
            return { moduleName };
        } finally {
            if (tempFile) {
                try {
                    tempFile.dispose();
                } catch {
                    // We don't care.
                }
            }
        }
    }

    private async downloadFastestCDN(moduleName: string, moduleVersion: string) {
        const deferred = createDeferred<TemporaryFile | undefined>();
        Promise.all(
            // For each CDN, try to download it.
            this.cdnProviders.map((cdn) =>
                this.downloadFromCDN(moduleName, moduleVersion, cdn).then((t) => {
                    // First one to get here wins. Meaning the first one that
                    // returns a valid temporary file. If a request doesn't download it will
                    // return undefined.
                    if (!deferred.resolved && t) {
                        deferred.resolve(t);
                    }
                })
            )
        )
            .then((_a) => {
                // If after running all requests, we're still not resolved, then return empty.
                // This would happen if both unpkg.com and jsdelivr failed.
                if (!deferred.resolved) {
                    deferred.resolve(undefined);
                }
            })
            .ignoreErrors();

        // Note, we only wait until one download finishes. We don't need to wait
        // for everybody (hence the use of the deferred)
        return deferred.promise;
    }

    private async downloadFromCDN(
        moduleName: string,
        moduleVersion: string,
        cdn: WidgetCDNs
    ): Promise<TemporaryFile | undefined> {
        // First validate CDN
        const downloadUrl = await this.generateDownloadUri(moduleName, moduleVersion, cdn);
        if (downloadUrl) {
            // Then see if we can download the file.
            try {
                return await this.downloadFile(downloadUrl);
            } catch (exc) {
                // Something goes wrong, just fail
            }
        }
    }

    private async generateDownloadUri(
        moduleName: string,
        moduleVersion: string,
        cdn: WidgetCDNs
    ): Promise<string | undefined> {
        const cdnBaseUrl = getCDNPrefix(cdn);
        if (cdnBaseUrl) {
            return moduleNameToCDNUrl(cdnBaseUrl, moduleName, moduleVersion);
        }
        return undefined;
    }

    private getModuleKey(moduleName: string, moduleVersion: string) {
        return sanitize(sha256().update(`${moduleName}${moduleVersion}`).digest('hex'));
    }

    private async downloadFile(downloadUrl: string): Promise<TemporaryFile | undefined> {
        // Create a temp file to download the results to
        const tempFile = await this.fs.createTemporaryLocalFile('.js');

        // Otherwise do an http get on the url. Retry at least 5 times
        let retryCount = 5;
        let success = false;
        while (retryCount > 0 && !success) {
            try {
                if (await this.fs.localFileExists(tempFile.filePath)) {
                    await this.fs.deleteLocalFile(tempFile.filePath);
                }
                traceInfo(
                    `${ConsoleForegroundColors.Green}Downloading from CDN ${downloadUrl} into ${tempFile.filePath}`
                );
                await download(downloadUrl, tempFile.filePath);
                traceInfo(
                    `${ConsoleForegroundColors.Green}Successfully downloaded from CDN ${downloadUrl} into ${tempFile.filePath}`
                );
                success = true;
            } catch (exc) {
                traceInfo(`Error downloading from ${downloadUrl}: `, exc);
            } finally {
                retryCount -= 1;
            }
        }

        // Once we make it out, return result
        if (success) {
            return tempFile;
        } else {
            tempFile.dispose();
        }
    }
}
