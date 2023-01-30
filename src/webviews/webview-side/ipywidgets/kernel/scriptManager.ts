// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fastDeepEqual from 'fast-deep-equal';
import { EventEmitter } from 'events';
import { PostOffice } from '../../react-common/postOffice';
import { ScriptLoader } from './types';
import { logErrorMessage, logMessage } from '../../react-common/logger';
import { Deferred, createDeferred } from '../../../../platform/common/utils/async';
import { SharedMessages, IPyWidgetMessages, IInteractiveWindowMapping } from '../../../../messageTypes';
import { IJupyterExtraSettings } from '../../../../platform/webviews/types';
import { isCDNReachable } from './helper';
import { noop } from '../../../../platform/common/utils/misc';
import { IDisposable } from '../../../../platform/common/types';
import { disposeAllDisposables } from '../../../../platform/common/helpers';
import { WidgetScriptSource } from '../../../../notebooks/controllers/ipywidgets/types';
import { warnAboutWidgetVersionsThatAreNotSupported } from './incompatibleWidgetHandler';
import { registerScripts, undefineModule } from './requirejsRegistry';

export class ScriptManager extends EventEmitter {
    public readonly widgetsRegisteredInRequireJs = new Set<string>();
    private readonly disposables: IDisposable[] = [];
    private baseUrl?: string;
    private readonly widgetSourceRequests = new Map<
        string,
        {
            deferred: Deferred<void>;
            timer: NodeJS.Timeout | number | undefined;
            explicitlyRequested: boolean;
            source?: 'cdn' | 'local' | 'remote';
            requestId: string;
        }
    >();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private previousKernelOptions?: any;
    private readonly registeredWidgetSources = new Map<string, WidgetScriptSource>();
    private readonly widgetModulesFailedToLoad = new Set<string>();
    private timedoutWaitingForWidgetsToGetLoaded?: boolean;
    private readonly isOnline = createDeferred<boolean>();
    private widgetsCanLoadFromCDN: boolean = false;
    // Total time to wait for a script to load. This includes ipywidgets making a request to extension for a Uri of a widget,
    // then extension replying back with the Uri (max 5 seconds round trip time).
    // If expires, then Widget downloader will attempt to download with what ever information it has (potentially failing).
    // Note, we might have a message displayed at the user end (asking for consent to use CDN).
    // Hence use 60 seconds.
    private readonly timeoutWaitingForScriptToLoad = 60_000;
    // List of widgets that must always be loaded using requirejs instead of using a CDN or the like.
    constructor(private readonly postOffice: PostOffice, cdnIsReachable = isCDNReachable()) {
        super();
        this.isOnline.promise.catch(noop);
        cdnIsReachable
            .then((isOnline) => {
                this.isOnline.resolve(isOnline);
                this.postOffice.sendMessage<IInteractiveWindowMapping>(IPyWidgetMessages.IPyWidgets_IsOnline, {
                    isOnline
                });
            })
            .catch((ex) => logErrorMessage(`Failed to check if online ${ex.toString()}`));

        postOffice.addHandler({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            handleMessage: (type: string, payload?: any) => {
                if (type === SharedMessages.UpdateSettings) {
                    const settings = JSON.parse(payload) as IJupyterExtraSettings;
                    this.widgetsCanLoadFromCDN = settings.widgetScriptSources.length > 0;
                } else if (type === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse) {
                    this.registerScriptSourceInRequirejs(payload as WidgetScriptSource);
                } else if (type === IPyWidgetMessages.IPyWidgets_AttemptToDownloadFailedWidgetsAgain) {
                    // This message is sent when we re-enable CDN or the like,
                    // & we can now attempt to fetch the widget scripts again.
                    // For this to be possible we need to clear the widgets from require.js and the fact that we also attempted to download it.
                    Array.from(this.widgetModulesFailedToLoad.values()).forEach((moduleName) => {
                        // If we don't have a source, then we can re-try fetching the source (next time its requested).
                        this.clearWidgetModuleScriptSource(moduleName);
                    });
                    this.widgetModulesFailedToLoad.clear();
                } else if (type === IPyWidgetMessages.IPyWidgets_BaseUrlResponse) {
                    const baseUrl = payload as string;
                    if (baseUrl) {
                        this.baseUrl = baseUrl;
                        // Required by Jupyter Notebook widgets.
                        // This base url is used to load additional resources.
                        document.body.dataset.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
                        logMessage(`data-base-url set to ${baseUrl}`);
                    }
                } else if (type === IPyWidgetMessages.IPyWidgets_kernelOptions) {
                    logMessage(`Received IPyWidgets_kernelOptions in ScriptManager`);
                    if (this.previousKernelOptions && !fastDeepEqual(this.previousKernelOptions, payload)) {
                        logMessage(`Received IPyWidgets_kernelOptions in ScriptManager with new kernel options`);
                        this.previousKernelOptions = payload;
                        this.clear();
                    }
                } else if (type === IPyWidgetMessages.IPyWidgets_onKernelChanged) {
                    logMessage(`Received IPyWidgets_onKernelChanged in ScriptManager`);
                    this.clear();
                }
                return true;
            }
        });
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public getScriptLoader(): ScriptLoader {
        return {
            widgetsRegisteredInRequireJs: this.widgetsRegisteredInRequireJs,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            errorHandler: (className: string, moduleName: string, moduleVersion: string, error: any) =>
                this.handleLoadError(className, moduleName, moduleVersion, error).catch(() => {
                    /* do nothing (this is so we don't pull in noop in misc.ts which will pull stuff that uses process.env) */
                }),
            loadWidgetScript: (moduleName: string, moduleVersion: string) =>
                this.loadWidgetScript(moduleName, moduleVersion),
            successHandler: (className: string, moduleName: string, moduleVersion: string) =>
                this.handleLoadSuccess(className, moduleName, moduleVersion)
        };
    }
    public onWidgetLoadSuccess(
        listener: (data: { className: string; moduleName: string; moduleVersion: string }) => void
    ): this {
        return this.on('onWidgetLoadSuccess', listener);
    }
    public onWidgetLoadError(
        listener: (data: {
            className: string;
            moduleName: string;
            moduleVersion: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            error: any;
            timedout?: boolean;
            isOnline: boolean;
        }) => void
    ): this {
        return this.on('onWidgetLoadError', listener);
    }
    public onWidgetVersionNotSupported(listener: (data: { moduleName: 'qgrid'; moduleVersion: string }) => void): this {
        return this.on('onWidgetVersionNotSupported', listener);
    }

    /**
     * Method called by ipywidgets to get the source for a widget.
     * When we get a source for the widget, we register it in requriejs.
     * We need to check if it is available on CDN, if not then fallback to local FS.
     * Or check local FS then fall back to CDN (depending on the order defined by the user).
     */
    public async loadWidgetScript(moduleName: string, moduleVersion: string): Promise<void> {
        // eslint-disable-next-line no-console
        logMessage(`Fetch IPyWidget source for ${moduleName}`);
        const isOnline = await this.isOnline.promise;
        let request = this.widgetSourceRequests.get(moduleName);
        const requestId = `${moduleName}:${moduleVersion}:${Date.now().toString()}`;

        if (isOnline && request && !request.explicitlyRequested && request.source !== 'cdn') {
            // If we're online and the widget was sourced from local/remote, try to fetch from CDN.
            // Sometimes what can happen is the script sources are sourced from local, even if CDN is available.
            // These scripts are sent from extension host as part of the startup.
            // In such cases we should make an explicit request for the source.
            request = undefined;
        }

        if (!request) {
            request = {
                deferred: createDeferred<void>(),
                timer: undefined,
                explicitlyRequested: true,
                requestId
            };

            // We don't want the calling code to unnecessary wait for too long.
            // Else UI will not get rendered due to blocking ipywidgets (at the end of the day ipywidgets gets loaded via kernel)
            // And kernel blocks the UI from getting processed.
            // Also, if we timeout once, then for subsequent attempts, wait for just 1 second.
            // Possible user has ignored some UI prompt and things are now in a state of limbo.
            // This way things will fall over sooner due to missing widget sources.
            const timeoutTime = this.timedoutWaitingForWidgetsToGetLoaded ? 5_000 : this.timeoutWaitingForScriptToLoad;

            request.timer = setTimeout(() => {
                if (request && !request.deferred.resolved) {
                    // eslint-disable-next-line no-console
                    console.error(`Timeout waiting to get widget source for ${moduleName}, ${moduleVersion}`);
                    this.handleLoadError(
                        '<class>',
                        moduleName,
                        moduleVersion,
                        new Error(`Timeout getting source for ${moduleName}:${moduleVersion}`),
                        true
                    ).catch(() => {
                        // Do nothing with errors
                    });
                    request.deferred.resolve();
                    this.timedoutWaitingForWidgetsToGetLoaded = true;
                }
            }, timeoutTime);
            this.disposables.push({
                dispose() {
                    try {
                        if (request?.timer) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            clearTimeout(request.timer as any);
                        }
                    } catch {
                        //
                    }
                }
            });
            this.widgetSourceRequests.set(moduleName, request);
        }
        // Whether we have the scripts or not, send message to extension.
        // Useful telemetry and also we know it was explicity requested by ipywidgets.
        this.postOffice.sendMessage<IInteractiveWindowMapping>(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest, {
            moduleName,
            moduleVersion,
            requestId
        });

        try {
            await request.deferred.promise;
            const widgetSource = this.registeredWidgetSources.get(moduleName);
            if (widgetSource) {
                warnAboutWidgetVersionsThatAreNotSupported(
                    widgetSource,
                    moduleVersion,
                    this.widgetsCanLoadFromCDN,
                    (info) =>
                        this.emit('onWidgetVersionNotSupported', {
                            moduleName: info.moduleName,
                            moduleVersion: info.moduleVersion
                        })
                );
            }
        } catch (ex) {
            // eslint-disable-next-line no-console
            console.error(`Failed to load Widget Script from Extension for ${moduleName}, ${moduleVersion}`, ex);
        }
    }

    public handleLoadSuccess(className: string, moduleName: string, moduleVersion: string) {
        this.emit('onWidgetLoadSuccess', { className, moduleName, moduleVersion });
    }

    private clearWidgetModuleScriptSource(moduleName: string) {
        this.widgetSourceRequests.delete(moduleName);
        this.registeredWidgetSources.delete(moduleName);
        this.widgetsRegisteredInRequireJs.delete(moduleName);
        undefineModule(moduleName);
    }
    /**
     * E.g. when we have restarted a kernel.
     * If user changed the kernel, then some widgets might exist now and some might now.
     */
    private clear() {
        this.widgetSourceRequests.clear();
        this.registeredWidgetSources.clear();
    }
    /**
     * Given a list of the widgets along with the sources, we will need to register them with requirejs.
     * IPyWidgets uses requirejs to dynamically load modules.
     * (https://requirejs.org/docs/api.html)
     * All we're doing here is given a widget (module) name, we register the path where the widget (module) can be loaded from.
     * E.g.
     * requirejs.config({ paths:{
     *  'widget_xyz': '<Url of script without trailing .js>'
     * }});
     */
    private registerScriptSourcesInRequirejs(sources: WidgetScriptSource[]) {
        logMessage(`Received IPyWidget scripts ${JSON.stringify(sources || [])}`);
        if (!Array.isArray(sources) || sources.length === 0) {
            return;
        }

        // Now resolve promises (anything that was waiting for modules to get registered can carry on).
        sources.forEach((source) => {
            // If we have a script from CDN, then don't overwrite that.
            // We want to always give preference to the widgets from CDN.
            const currentRegistration = this.registeredWidgetSources.get(source.moduleName);
            if (!currentRegistration || (currentRegistration.source && currentRegistration.source !== 'cdn')) {
                registerScripts(this.baseUrl, [source]);
                this.registeredWidgetSources.set(source.moduleName, source);
                this.widgetsRegisteredInRequireJs.add(source.moduleName);
            }

            // We have fetched the script sources for all of these modules.
            // In some cases we might not have the source, meaning we don't have it or couldn't find it.
            let request = this.widgetSourceRequests.get(source.moduleName);
            if (!request) {
                request = {
                    deferred: createDeferred(),
                    timer: undefined,
                    source: source.source,
                    requestId: source.requestId || '',
                    explicitlyRequested: false
                };
                this.widgetSourceRequests.set(source.moduleName, request);
            }
            if (source.requestId && source.requestId === request!.requestId) {
                request.source = source.source;
                request.deferred.resolve();
            } else if (!source.requestId) {
                request.source = source.source;
                request.deferred.resolve();
            }
            if (request.deferred.completed && request.timer !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                clearTimeout(request.timer as any); // This is to make this work on Node and Browser
            }
        });
    }
    private registerScriptSourceInRequirejs(source?: WidgetScriptSource) {
        if (!source) {
            logMessage('No widget script source');
            return;
        }
        this.registerScriptSourcesInRequirejs([source]);
    }
    private async handleLoadError(
        className: string,
        moduleName: string,
        moduleVersion: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        error: any,
        timedout: boolean = false
    ) {
        this.widgetModulesFailedToLoad.add(moduleName);
        const isOnline = await isCDNReachable();
        this.emit('onWidgetLoadError', { className, moduleName, moduleVersion, error, timedout, isOnline });
    }
}
