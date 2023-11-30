// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { ConfigurationTarget, Memento } from 'vscode';
import { IApplicationShell } from '../../../../platform/common/application/types';
import { Telemetry } from '../../../../platform/common/constants';
import { GLOBAL_MEMENTO, IConfigurationService, IMemento, WidgetCDNs } from '../../../../platform/common/types';
import { createDeferred, createDeferredFromPromise, Deferred } from '../../../../platform/common/utils/async';
import { Common, DataScience } from '../../../../platform/common/utils/localize';
import { noop } from '../../../../platform/common/utils/misc';
import { traceError, traceInfo, traceVerbose } from '../../../../platform/logging';
import { ConsoleForegroundColors } from '../../../../platform/logging/types';
import { sendTelemetryEvent } from '../../../../telemetry';
import { IWidgetScriptSourceProvider, WidgetScriptSource } from '../types';
import { HttpClient } from '../../../../platform/common/net/httpClient';

// Source borrowed from https://github.com/jupyter-widgets/ipywidgets/blob/54941b7a4b54036d089652d91b39f937bde6b6cd/packages/html-manager/src/libembed-amd.ts#L33
const unpgkUrl = 'https://unpkg.com/';
const jsdelivrUrl = 'https://cdn.jsdelivr.net/npm/';

export const GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce = 'IPYWidgetCDNConfigured';
export const GlobalStateKeyToNeverWarnAboutScriptsNotFoundOnCDN = 'IPYWidgetNotFoundOnCDN';
export const GlobalStateKeyToNeverWarnAboutNoNetworkAccess = 'IPYWidgetNoNetWorkAccess';

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
@injectable()
export class CDNWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    private cache = new Map<string, Promise<WidgetScriptSource>>();
    private isOnCDNCache = new Map<string, Promise<boolean>>();
    private readonly notifiedUserAboutWidgetScriptNotFound = new Set<string>();
    private get cdnProviders(): readonly WidgetCDNs[] {
        const settings = this.configurationSettings.getSettings(undefined);
        return settings.widgetScriptSources;
    }
    private configurationPromise?: Deferred<void>;
    constructor(
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IConfigurationService) private readonly configurationSettings: IConfigurationService
    ) {}
    public dispose() {
        this.cache.clear();
    }
    /**
     * Whether the module is available on the CDN.
     */
    public async isOnCDN(moduleName: string): Promise<boolean> {
        const key = `MODULE_VERSION_ON_CDN_${moduleName}`;
        if (this.isOnCDNCache.has(key)) {
            return this.isOnCDNCache.get(key)!;
        }
        if (this.globalMemento.get<boolean>(key, false)) {
            return true;
        }
        const promise = (async () => {
            const httpClient = new HttpClient();
            const unpkgPromise = createDeferredFromPromise(httpClient.exists(`${unpgkUrl}${moduleName}`));
            const jsDeliverPromise = createDeferredFromPromise(httpClient.exists(`${jsdelivrUrl}${moduleName}`));
            await Promise.race([unpkgPromise.promise, jsDeliverPromise.promise]);
            if (unpkgPromise.value || jsDeliverPromise.value) {
                return true;
            }
            await Promise.all([unpkgPromise.promise, jsDeliverPromise.promise]);
            return unpkgPromise.value || jsDeliverPromise.value ? true : false;
        })();
        // Keep this in cache.
        promise
            .then((exists) => {
                if (exists) {
                    return this.globalMemento.update(key, true);
                }
            })
            .then(noop, noop);
        this.isOnCDNCache.set(key, promise);
        return promise;
    }
    public async getWidgetScriptSource(
        moduleName: string,
        moduleVersion: string,
        isWebViewOnline?: boolean
    ): Promise<WidgetScriptSource> {
        // If the webview is not online, then we cannot use the CDN.
        if (isWebViewOnline === false) {
            this.warnIfNoAccessToInternetFromWebView(moduleName).catch(noop);
            return {
                moduleName
            };
        }
        if (
            this.cdnProviders.length === 0 &&
            this.globalMemento.get<boolean>(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, false)
        ) {
            return {
                moduleName
            };
        }
        // First see if we already have it downloaded.
        const key = this.getModuleKey(moduleName, moduleVersion);
        if (!this.cache.get(key)) {
            this.cache.set(key, this.getWidgetScriptSourceImplementation(moduleName, moduleVersion));
        }
        return this.cache.get(key)!;
    }
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
        return `${moduleName}${moduleVersion}`;
    }
    protected async getWidgetScriptSourceImplementation(
        moduleName: string,
        moduleVersion: string
    ): Promise<WidgetScriptSource> {
        traceInfo(
            `${
                ConsoleForegroundColors.Green
            }Searching for Widget Script ${moduleName}#${moduleVersion} using cdns ${this.cdnProviders.join(' ')}`
        );
        await this.configureWidgets();
        if (this.cdnProviders.length === 0) {
            return { moduleName };
        }
        // Try all cdns
        const uris = await Promise.all(
            this.cdnProviders.map((cdn) => this.getValidUri(moduleName, moduleVersion, cdn))
        );
        const scriptUri = uris.find((u) => u);
        if (scriptUri) {
            traceInfo(
                `${ConsoleForegroundColors.Green}Widget Script ${moduleName}#${moduleVersion} found at URI: ${scriptUri}`
            );
            return { moduleName, scriptUri, source: 'cdn' };
        }

        traceError(`Widget Script ${moduleName}#${moduleVersion} was not found on on any cdn`);
        this.handleWidgetSourceNotFound(moduleName, moduleVersion).catch(noop);
        return { moduleName };
    }

    private async getValidUri(moduleName: string, moduleVersion: string, cdn: WidgetCDNs): Promise<string | undefined> {
        // Make sure CDN has the item before returning it.
        try {
            const downloadUrl = await this.generateDownloadUri(moduleName, moduleVersion, cdn);
            const httpClient = new HttpClient();
            if (downloadUrl && (await httpClient.exists(downloadUrl))) {
                return downloadUrl;
            }
        } catch (ex) {
            traceVerbose(`Failed downloading ${moduleName}:${moduleVersion} from ${cdn}`);
            return undefined;
        }
    }
    private async warnIfNoAccessToInternetFromWebView(moduleName: string) {
        // if widget exists nothing to do.
        if (this.globalMemento.get<boolean>(GlobalStateKeyToNeverWarnAboutNoNetworkAccess, false)) {
            return;
        }
        if (this.notifiedUserAboutWidgetScriptNotFound.has(moduleName) || this.cdnProviders.length === 0) {
            return;
        }
        this.notifiedUserAboutWidgetScriptNotFound.add(moduleName);
        const selection = await this.appShell.showWarningMessage(
            DataScience.cdnWidgetScriptNotAccessibleWarningMessage(moduleName, JSON.stringify(this.cdnProviders)),
            Common.ok,
            Common.doNotShowAgain,
            Common.moreInfo
        );
        switch (selection) {
            case Common.doNotShowAgain:
                return this.globalMemento.update(GlobalStateKeyToNeverWarnAboutNoNetworkAccess, true);
            case Common.moreInfo:
                return this.appShell.openUrl('https://aka.ms/PVSCIPyWidgets');
            default:
                noop();
        }
    }

    private async configureWidgets(): Promise<void> {
        if (this.cdnProviders.length !== 0) {
            return;
        }

        if (this.globalMemento.get<boolean>(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, false)) {
            return;
        }

        if (this.configurationPromise) {
            return this.configurationPromise.promise;
        }
        this.configurationPromise = createDeferred();
        sendTelemetryEvent(Telemetry.IPyWidgetPromptToUseCDN);
        const selection = await this.appShell.showInformationMessage(
            DataScience.useCDNForWidgetsNoInformation,
            { modal: true },
            Common.ok,
            Common.doNotShowAgain,
            Common.moreInfo
        );

        let selectionForTelemetry: 'ok' | 'cancel' | 'dismissed' | 'doNotShowAgain' = 'dismissed';
        switch (selection) {
            case Common.ok: {
                selectionForTelemetry = 'ok';
                // always search local interpreter or attempt to fetch scripts from remote jupyter server as backups.
                await Promise.all([
                    this.updateScriptSources(['jsdelivr.com', 'unpkg.com']),
                    this.globalMemento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, true)
                ]);
                break;
            }
            case Common.doNotShowAgain: {
                selectionForTelemetry = 'doNotShowAgain';
                // At a minimum search local interpreter or attempt to fetch scripts from remote jupyter server.
                await Promise.all([
                    this.updateScriptSources([]),
                    this.globalMemento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, true)
                ]);
                break;
            }
            case Common.moreInfo: {
                this.appShell.openUrl('https://aka.ms/PVSCIPyWidgets');
                break;
            }
            default:
                selectionForTelemetry = selection === Common.cancel ? 'cancel' : 'dismissed';
                break;
        }

        sendTelemetryEvent(Telemetry.IPyWidgetPromptToUseCDNSelection, undefined, { selection: selectionForTelemetry });
        this.configurationPromise.resolve();
    }
    private async updateScriptSources(scriptSources: WidgetCDNs[]) {
        const targetSetting = 'widgetScriptSources';
        await this.configurationSettings.updateSetting(
            targetSetting,
            scriptSources,
            undefined,
            ConfigurationTarget.Global
        );
    }
    private async handleWidgetSourceNotFound(moduleName: string, version: string) {
        // if widget exists nothing to do.
        if (this.globalMemento.get<boolean>(GlobalStateKeyToNeverWarnAboutScriptsNotFoundOnCDN, false)) {
            return;
        }
        if (this.notifiedUserAboutWidgetScriptNotFound.has(moduleName) || this.cdnProviders.length === 0) {
            return;
        }
        this.notifiedUserAboutWidgetScriptNotFound.add(moduleName);
        const selection = await this.appShell.showWarningMessage(
            DataScience.widgetScriptNotFoundOnCDNWidgetMightNotWork(
                moduleName,
                version,
                JSON.stringify(this.cdnProviders)
            ),
            Common.ok,
            Common.doNotShowAgain,
            Common.reportThisIssue
        );
        switch (selection) {
            case Common.doNotShowAgain:
                return this.globalMemento.update(GlobalStateKeyToNeverWarnAboutScriptsNotFoundOnCDN, true);
            case Common.reportThisIssue:
                return this.appShell.openUrl('https://aka.ms/CreatePVSCDataScienceIssue');
            default:
                noop();
        }
    }
}
