// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as fastDeepEqual from 'fast-deep-equal';
import { EventEmitter } from 'events';
import * as isonline from 'is-online';
import '../../../client/common/extensions';
import { createDeferred, Deferred } from '../../../client/common/utils/async';
import { noop } from '../../../client/common/utils/misc';
import {
    IInteractiveWindowMapping,
    IPyWidgetMessages
} from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { WidgetScriptSource } from '../../../client/datascience/ipywidgets/types';
import { SharedMessages } from '../../../client/datascience/messages';
import { IJupyterExtraSettings } from '../../../client/datascience/types';
import { PostOffice } from '../../react-common/postOffice';
import { warnAboutWidgetVersionsThatAreNotSupported } from '../common/incompatibleWidgetHandler';
import { registerScripts } from '../common/requirejsRegistry';
import { ScriptLoader } from './types';

export class ScriptManager extends EventEmitter {
    public readonly widgetsRegisteredInRequireJs = new Set<string>();
    private readonly widgetSourceRequests = new Map<
        string,
        { deferred: Deferred<void>; timer: NodeJS.Timeout | number | undefined }
    >();
    private previousKernelOptions?: any;
    private readonly registeredWidgetSources = new Map<string, WidgetScriptSource>();
    private timedoutWaitingForWidgetsToGetLoaded?: boolean;
    private widgetsCanLoadFromCDN: boolean = false;
    // Total time to wait for a script to load. This includes ipywidgets making a request to extension for a Uri of a widget,
    // then extension replying back with the Uri (max 5 seconds round trip time).
    // If expires, then Widget downloader will attempt to download with what ever information it has (potentially failing).
    // Note, we might have a message displayed at the user end (asking for consent to use CDN).
    // Hence use 60 seconds.
    private readonly timeoutWaitingForScriptToLoad = 60_000;
    // List of widgets that must always be loaded using requirejs instead of using a CDN or the like.
    constructor(private readonly postOffice: PostOffice) {
        super();
        postOffice.addHandler({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            handleMessage: (type: string, payload?: any) => {
                if (type === SharedMessages.UpdateSettings) {
                    const settings = JSON.parse(payload) as IJupyterExtraSettings;
                    this.widgetsCanLoadFromCDN = settings.widgetScriptSources.length > 0;
                } else if (type === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse) {
                    console.warn(`Got scripr ${(payload as WidgetScriptSource).moduleName}`);
                    this.registerScriptSourceInRequirejs(payload as WidgetScriptSource);
                } else if (type === IPyWidgetMessages.IPyWidgets_kernelOptions) {
                    console.warn(`IPyWidgets_kernelOptions in ScriptManager`);
                    if (this.previousKernelOptions && !fastDeepEqual(this.previousKernelOptions, payload)) {
                        console.error(`IPyWidgets_kernelOptions in ScriptManager and they are different`);
                        console.error(this.previousKernelOptions);
                        console.error(payload);
                        this.previousKernelOptions = payload;
                        this.clear();
                    }
                } else if (type === IPyWidgetMessages.IPyWidgets_onKernelChanged) {
                    console.warn(`IPyWidgets_onKernelChanged in ScriptManager`);
                    this.clear();
                }
                return true;
            }
        });
    }
    public getScriptLoader(): ScriptLoader {
        return {
            widgetsRegisteredInRequireJs: this.widgetsRegisteredInRequireJs,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            errorHandler: (className: string, moduleName: string, moduleVersion: string, error: any) =>
                this.handleLoadError(className, moduleName, moduleVersion, error).catch(noop),
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
    public loadWidgetScript(moduleName: string, moduleVersion: string): Promise<void> {
        // eslint-disable-next-line no-console
        console.error(`Fetch IPyWidget source for ${moduleName}, ${moduleVersion}`);
        let request = this.widgetSourceRequests.get(moduleName);
        if (!request) {
            console.error(`Fetch IPyWidget source for (not found) ${moduleName}, ${moduleVersion}`);
            request = {
                deferred: createDeferred<void>(),
                timer: undefined
            };

            // If we timeout, then resolve this promise.
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
                    ).ignoreErrors();
                    request.deferred.resolve();
                    this.timedoutWaitingForWidgetsToGetLoaded = true;
                }
            }, timeoutTime);

            this.widgetSourceRequests.set(moduleName, request);
        } else {
            console.log(`Fetch IPyWidget source for (found) ${moduleName}, ${moduleVersion}`);
        }
        // Whether we have the scripts or not, send message to extension.
        // Useful telemetry and also we know it was explicity requested by ipywidgets.
        this.postOffice.sendMessage<IInteractiveWindowMapping>(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest, {
            moduleName,
            moduleVersion
        });

        return request.deferred.promise
            .then(() => {
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
            })
            .catch((ex) =>
                // eslint-disable-next-line no-console
                console.error(`Failed to load Widget Script from Extension for for ${moduleName}, ${moduleVersion}`, ex)
            );
    }

    public handleLoadSuccess(className: string, moduleName: string, moduleVersion: string) {
        this.emit('onWidgetLoadSuccess', { className, moduleName, moduleVersion });
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
        if (!Array.isArray(sources) || sources.length === 0) {
            return;
        }
        console.warn(`registerScriptSourcesInRequirejs ${sources.map((item) => item.moduleName).join(', ')}`);
        console.warn(`registerScriptSourcesInRequirejs ${sources.map((item) => item.scriptUri).join(', ')}`);
        registerScripts(sources);

        // Now resolve promises (anything that was waiting for modules to get registered can carry on).
        sources.forEach((source) => {
            console.warn(`registerScriptSourcesInRequirejs2 ${source.moduleName}`);
            this.registeredWidgetSources.set(source.moduleName, source);
            // We have fetched the script sources for all of these modules.
            // In some cases we might not have the source, meaning we don't have it or couldn't find it.
            let request = this.widgetSourceRequests.get(source.moduleName);
            if (!request) {
                request = {
                    deferred: createDeferred(),
                    timer: undefined
                };
                this.widgetSourceRequests.set(source.moduleName, request);
            }
            request.deferred.resolve();
            console.warn(`registerScriptSourcesInRequirejs3 ${source.moduleName}`);
            if (request.timer !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                clearTimeout(request.timer as any); // This is to make this work on Node and Browser
            }
        });
    }
    private registerScriptSourceInRequirejs(source?: WidgetScriptSource) {
        if (!source) {
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
        const isOnline = await isonline.default({ timeout: 1000 });
        this.emit('onWidgetLoadError', { className, moduleName, moduleVersion, error, timedout, isOnline });
    }
}
