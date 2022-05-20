// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as urlPath from '../../platform/vscode-path/resources';
import { traceError, traceInfo, traceInfoIfCI } from '../../platform/logging';
import { IFileSystem, TemporaryFileUri } from '../../platform/common/platform/types';
import { IConfigurationService, IHttpClient, WidgetCDNs } from '../../platform/common/types';
import { createDeferred } from '../../platform/common/utils/async';
import { ILocalResourceUriConverter, WidgetScriptSource } from './types';
import { ConsoleForegroundColors } from '../../platform/logging/types';
import { BaseCDNWidgetScriptSourceProvider } from './cdnWidgetScriptSourceProvider.base';

/**
 * Widget scripts are found in CDN.
 * Given an widget module name & version, this will attempt to find the Url on a CDN.
 * We'll need to stick to the order of preference prescribed by the user.
 */
export class CDNWidgetScriptSourceProvider extends BaseCDNWidgetScriptSourceProvider {
    constructor(
        configurationSettings: IConfigurationService,
        private readonly localResourceUriConverter: ILocalResourceUriConverter,
        private readonly fs: IFileSystem,
        private readonly httpClient: IHttpClient
    ) {
        super(configurationSettings);
    }
    protected async getWidgetScriptSourceImplementation(
        moduleName: string,
        moduleVersion: string
    ): Promise<WidgetScriptSource> {
        // First see if we already have it downloaded.
        const key = this.getModuleKey(moduleName, moduleVersion);
        const diskPath = urlPath.joinPath(this.localResourceUriConverter.rootScriptFolder, key, 'index.js');
        let tempFile: TemporaryFileUri | undefined;

        // Log the location that we are going to search on disk (don't remove, can allow third parties to drop
        // files locally and test new versions of their extensions.
        traceInfo(
            `${ConsoleForegroundColors.Green}Searching for Widget Script ${moduleName}#${moduleVersion} at path: ${diskPath}`
        );

        // Might be on disk, try there first.
        if (diskPath && (await this.fs.exists(diskPath))) {
            traceInfo(
                `${ConsoleForegroundColors.Green}Widget Script ${moduleName}#${moduleVersion} found at path: ${diskPath}`
            );
            const scriptUri = (await this.localResourceUriConverter.asWebviewUri(diskPath)).toString();
            return { moduleName, scriptUri, source: 'cdn' };
        }

        // If still not found, download it.
        try {
            traceInfo(`${ConsoleForegroundColors.Green}Widget Script ${moduleName}#${moduleVersion} searching`);
            // Make sure the disk path directory exists. We'll be downloading it to there.
            await this.fs.createDirectory(urlPath.dirname(diskPath));

            // Then get the first one that returns.
            tempFile = await this.downloadFastestCDN(moduleName, moduleVersion);
            if (tempFile) {
                traceInfo(
                    `${ConsoleForegroundColors.Green}Wiget ${moduleName} successfully downloaded to temp file ${tempFile.file}`
                );
                traceInfoIfCI(
                    `Widget Script downloaded for ${moduleName}:${moduleVersion}, already downloaded ${await this.fs.exists(
                        diskPath
                    )}`
                );
                if (!(await this.fs.exists(diskPath))) {
                    traceInfo(`${ConsoleForegroundColors.Green}Wiget ${moduleName} being copied into ${diskPath}`);
                    // Need to copy from the temporary file to our real file (note: VSC filesystem fails to copy so just use straight file system)
                    await this.fs.copy(tempFile.file, diskPath);
                }

                // Now we can generate the script URI so the local converter doesn't try to copy it.
                const scriptUri = (await this.localResourceUriConverter.asWebviewUri(diskPath)).toString();
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
        const deferred = createDeferred<TemporaryFileUri | undefined>();
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
    ): Promise<TemporaryFileUri | undefined> {
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

    private async downloadFile(downloadUrl: string): Promise<TemporaryFileUri | undefined> {
        // Create a temp file to download the results to
        const tempFile = await this.fs.createTemporaryFile({ fileExtension: '.js' });

        // Otherwise do an http get on the url. Retry at least 5 times
        let retryCount = 5;
        let success = false;
        while (retryCount > 0 && !success) {
            try {
                traceInfo(`${ConsoleForegroundColors.Green}Downloading from CDN ${downloadUrl} into ${tempFile.file}`);
                const response = await this.httpClient.downloadFile(downloadUrl);
                if (response.status === 200) {
                    const contents = await response.text();
                    await this.fs.writeFile(tempFile.file, contents);
                    traceInfo(
                        `${ConsoleForegroundColors.Green}Successfully downloaded from CDN ${downloadUrl} into ${tempFile.file}`
                    );
                    success = true;
                } else {
                    traceError(`Error downloading from ${downloadUrl}: ${response.statusText}`);
                }
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
