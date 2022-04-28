// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ConfigurationChangeEvent, ConfigurationTarget } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import '../../platform/common/extensions';
import { traceError } from '../../platform/logging';
import {
    WidgetCDNs,
    IPersistentState,
    IConfigurationService,
    IPersistentStateFactory,
    IHttpClient
} from '../../platform/common/types';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
import { DataScience, Common } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../telemetry/helpers';
import { Telemetry } from '../../webviews/webview-side/common/constants';
import { IKernel } from '../types';
import {
    ILocalResourceUriConverter,
    IWidgetScriptSourceProvider,
    IWidgetScriptSourceProviderFactory,
    WidgetScriptSource
} from './types';

const GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce = 'IPYWidgetCDNConfigured';
const GlobalStateKeyToNeverWarnAboutScriptsNotFoundOnCDN = 'IPYWidgetNotFoundOnCDN';

/**
 * This class decides where to get widget scripts from.
 * Whether its cdn or local or other, and also controls the order/priority.
 * If user changes the order, this will react to those configuration setting changes.
 * If user has not configured antying, user will be presented with a prompt.
 */
export class IPyWidgetScriptSourceProvider implements IWidgetScriptSourceProvider {
    private readonly notifiedUserAboutWidgetScriptNotFound = new Set<string>();
    private scriptProviders?: IWidgetScriptSourceProvider[];
    private configurationPromise?: Deferred<void>;
    private get configuredScriptSources(): readonly WidgetCDNs[] {
        const settings = this.configurationSettings.getSettings(undefined);
        return settings.widgetScriptSources;
    }
    private readonly userConfiguredCDNAtLeastOnce: IPersistentState<boolean>;
    private readonly neverWarnAboutScriptsNotFoundOnCDN: IPersistentState<boolean>;
    constructor(
        private readonly kernel: IKernel,
        private readonly localResourceUriConverter: ILocalResourceUriConverter,
        private readonly appShell: IApplicationShell,
        private readonly configurationSettings: IConfigurationService,
        private readonly workspaceService: IWorkspaceService,
        private readonly stateFactory: IPersistentStateFactory,
        private readonly httpClient: IHttpClient | undefined,
        private readonly sourceProviderFactory: IWidgetScriptSourceProviderFactory
    ) {
        this.userConfiguredCDNAtLeastOnce = this.stateFactory.createGlobalPersistentState<boolean>(
            GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce,
            false
        );
        this.neverWarnAboutScriptsNotFoundOnCDN = this.stateFactory.createGlobalPersistentState<boolean>(
            GlobalStateKeyToNeverWarnAboutScriptsNotFoundOnCDN,
            false
        );
    }
    public initialize() {
        this.workspaceService.onDidChangeConfiguration(this.onSettingsChagned.bind(this));
    }
    public dispose() {
        this.disposeScriptProviders();
    }
    /**
     * We know widgets are being used, at this point prompt user if required.
     */
    public async getWidgetScriptSource(
        moduleName: string,
        moduleVersion: string
    ): Promise<Readonly<WidgetScriptSource>> {
        await this.configureWidgets();
        if (!this.scriptProviders) {
            this.rebuildProviders();
        }

        // Get script sources in order, if one works, then get out.
        const scriptSourceProviders = (this.scriptProviders || []).slice();
        let found: WidgetScriptSource = { moduleName };
        while (scriptSourceProviders.length) {
            const scriptProvider = scriptSourceProviders.shift();
            if (!scriptProvider) {
                continue;
            }
            const source = await scriptProvider.getWidgetScriptSource(moduleName, moduleVersion);
            // If we found the script source, then use that.
            if (source.scriptUri) {
                found = source;
                break;
            }
        }

        sendTelemetryEvent(Telemetry.HashedIPyWidgetNameUsed, undefined, {
            hashedName: getTelemetrySafeHashedString(found.moduleName),
            source: found.source,
            cdnSearched: this.configuredScriptSources.length > 0
        });

        if (!found.scriptUri) {
            traceError(`Script source for Widget ${moduleName}@${moduleVersion} not found`);
        }
        this.handleWidgetSourceNotFoundOnCDN(found, moduleVersion).ignoreErrors();
        return found;
    }
    private async handleWidgetSourceNotFoundOnCDN(widgetSource: WidgetScriptSource, version: string) {
        // if widget exists nothing to do.
        if (widgetSource.source === 'cdn' || this.neverWarnAboutScriptsNotFoundOnCDN.value === true) {
            return;
        }
        if (
            this.notifiedUserAboutWidgetScriptNotFound.has(widgetSource.moduleName) ||
            this.configuredScriptSources.length === 0
        ) {
            return;
        }
        this.notifiedUserAboutWidgetScriptNotFound.add(widgetSource.moduleName);
        const selection = await this.appShell.showWarningMessage(
            DataScience.widgetScriptNotFoundOnCDNWidgetMightNotWork().format(
                widgetSource.moduleName,
                version,
                JSON.stringify(this.configuredScriptSources)
            ),
            Common.ok(),
            Common.doNotShowAgain(),
            Common.reportThisIssue()
        );
        switch (selection) {
            case Common.doNotShowAgain():
                return this.neverWarnAboutScriptsNotFoundOnCDN.updateValue(true);
            case Common.reportThisIssue():
                return this.appShell.openUrl('https://aka.ms/CreatePVSCDataScienceIssue');
            default:
                noop();
        }
    }

    private onSettingsChagned(e: ConfigurationChangeEvent) {
        if (e.affectsConfiguration('jupyter.widgetScriptSources')) {
            this.rebuildProviders();
        }
    }
    private disposeScriptProviders() {
        while (this.scriptProviders && this.scriptProviders.length) {
            const item = this.scriptProviders.shift();
            if (item) {
                item.dispose();
            }
        }
    }
    private rebuildProviders() {
        this.disposeScriptProviders();

        // Use the platform specific factory to get our providers
        this.scriptProviders = this.sourceProviderFactory.getProviders(
            this.kernel,
            this.localResourceUriConverter,
            this.httpClient
        );
    }

    private async configureWidgets(): Promise<void> {
        if (this.configuredScriptSources.length !== 0) {
            return;
        }

        if (this.userConfiguredCDNAtLeastOnce.value) {
            return;
        }

        if (this.configurationPromise) {
            return this.configurationPromise.promise;
        }
        this.configurationPromise = createDeferred();
        sendTelemetryEvent(Telemetry.IPyWidgetPromptToUseCDN);
        const selection = await this.appShell.showInformationMessage(
            DataScience.useCDNForWidgets(),
            Common.ok(),
            Common.cancel(),
            Common.doNotShowAgain()
        );

        let selectionForTelemetry: 'ok' | 'cancel' | 'dismissed' | 'doNotShowAgain' = 'dismissed';
        switch (selection) {
            case Common.ok(): {
                selectionForTelemetry = 'ok';
                // always search local interpreter or attempt to fetch scripts from remote jupyter server as backups.
                await Promise.all([
                    this.updateScriptSources(['jsdelivr.com', 'unpkg.com']),
                    this.userConfiguredCDNAtLeastOnce.updateValue(true)
                ]);
                break;
            }
            case Common.doNotShowAgain(): {
                selectionForTelemetry = 'doNotShowAgain';
                // At a minimum search local interpreter or attempt to fetch scripts from remote jupyter server.
                await Promise.all([this.updateScriptSources([]), this.userConfiguredCDNAtLeastOnce.updateValue(true)]);
                break;
            }
            default:
                selectionForTelemetry = selection === Common.cancel() ? 'cancel' : 'dismissed';
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
}
