// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { sha256 } from 'hash.js';
import { IConfigurationService, WidgetCDNs } from '../../platform/common/types';
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
export abstract class BaseCDNWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    protected get cdnProviders(): readonly WidgetCDNs[] {
        const settings = this.configurationSettings.getSettings(undefined);
        return settings.widgetScriptSources;
    }
    private cache = new Map<string, Promise<WidgetScriptSource>>();
    constructor(private readonly configurationSettings: IConfigurationService) {}
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
    protected abstract getWidgetScriptSourceImplementation(
        moduleName: string,
        moduleVersion: string
    ): Promise<WidgetScriptSource>;

    protected async generateDownloadUri(
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

    protected getModuleKey(moduleName: string, moduleVersion: string) {
        return sanitize(sha256().update(`${moduleName}${moduleVersion}`).digest('hex'));
    }
}
