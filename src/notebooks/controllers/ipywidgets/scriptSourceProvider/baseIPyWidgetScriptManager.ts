// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { disposeAllDisposables, splitLines, trimQuotes } from '../../../../platform/common/helpers';
import { getDisplayPath } from '../../../../platform/common/platform/fs-paths';
import { IDisposable } from '../../../../platform/common/types';
import { traceError, traceInfoIfCI, traceWarning } from '../../../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../../../telemetry';
import { IKernel, isLocalConnection } from '../../../../kernels/types';
import { getTelemetrySafeHashedString } from '../../../../platform/telemetry/helpers';
import stripComments from 'strip-comments';
import { IIPyWidgetScriptManager } from '../types';
import { StopWatch } from '../../../../platform/common/utils/stopWatch';
import { isCI } from '../../../../platform/common/constants';

export async function extractRequireConfigFromWidgetEntry(baseUrl: Uri, widgetFolderName: string, contents: string) {
    // Look for `require.config(` or `window["require"].config` or `window['requirejs'].config`
    const patternsToLookFor = [
        'require.config({',
        'requirejs.config({',
        '["require"].config({',
        "['require'].config({",
        '["requirejs"].config({',
        "['requirejs'].config({",
        '["require"]["config"]({',
        "['require']['config']({",
        '["requirejs"]["config"]({',
        "['requirejs']['config']({"
    ];
    const widgetFolderNameHash = await getTelemetrySafeHashedString(widgetFolderName);
    let indexOfRequireConfig = 0;
    let patternUsedToRegisterRequireConfig: string | undefined;
    while (indexOfRequireConfig <= 0 && patternsToLookFor.length) {
        patternUsedToRegisterRequireConfig = patternsToLookFor.pop();
        if (!patternUsedToRegisterRequireConfig) {
            break;
        }
        indexOfRequireConfig = contents.indexOf(patternUsedToRegisterRequireConfig);
    }

    if (indexOfRequireConfig < 0) {
        sendTelemetryEvent(Telemetry.IPyWidgetExtensionJsInfo, undefined, {
            widgetFolderNameHash,
            failed: true,
            patternUsedToRegisterRequireConfig,
            failure: 'couldNotLocateRequireConfigStart'
        });
        return;
    }

    // Find the end bracket for the require config call.
    const endBracket = contents.indexOf(')', indexOfRequireConfig);
    if (endBracket <= 0 || !patternUsedToRegisterRequireConfig) {
        sendTelemetryEvent(Telemetry.IPyWidgetExtensionJsInfo, undefined, {
            widgetFolderNameHash,
            failed: true,
            patternUsedToRegisterRequireConfig,
            failure: 'couldNotLocateRequireConfigEnd'
        });
        return;
    }
    const startBracket = contents.indexOf('{', indexOfRequireConfig);
    let configStr = contents.substring(startBracket, endBracket);
    // the config entry is js, and not json.
    // We cannot eval as thats dangerous, and we cannot use JSON.parse either as it not JSON.
    // Lets just extract what we need.
    configStr = stripComments(configStr, { language: 'javascript' });
    configStr = splitLines(configStr, { trim: true, removeEmptyEntries: true }).join('');
    // Now that we have just valid JS, extract contents between the third '{' and corresponding ending '}'
    const mappings = configStr
        .split('{')[3]
        .split('}')[0]
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length && entry.includes(':'));
    // We should now end up with something like the following:
    /*
    [
    "beakerx: 'nbextensions/beakerx/index'",
    "'jupyter-js-widgets': 'nbextensions/jupyter-js-widgets/extension'",
    "'@jupyter-widgets/base': 'nbextensions/jupyter-js-widgets/extension'",
    "'@jupyter-widgets/controls': 'nbextensions/jupyter-js-widgets/extension'",
    ''
    ]
    */

    const requireConfig: Record<string, Uri> = {};
    // Go through each and extract the key and the value.
    mappings.forEach((mapping) => {
        const parts = mapping.split(':');
        const key = trimQuotes(parts[0].trim()).trim();
        const value = trimQuotes(parts[1].trim()).trim();
        requireConfig[key] = Uri.joinPath(baseUrl, value);
    });

    if (!requireConfig || !Object.keys(requireConfig).length) {
        sendTelemetryEvent(Telemetry.IPyWidgetExtensionJsInfo, undefined, {
            widgetFolderNameHash,
            failed: true,
            patternUsedToRegisterRequireConfig,
            failure: 'noRequireConfigEntries'
        });
        return;
    }
    sendTelemetryEvent(
        Telemetry.IPyWidgetExtensionJsInfo,
        { requireEntryPointCount: Object.keys(requireConfig).length },
        {
            widgetFolderNameHash,
            patternUsedToRegisterRequireConfig
        }
    );

    return requireConfig;
}

/**
 * Maps require config entries to the corresponding uri.
 */
export abstract class BaseIPyWidgetScriptManager implements IIPyWidgetScriptManager {
    protected readonly disposables: IDisposable[] = [];
    private widgetModuleMappings?: Promise<Record<string, Uri> | undefined>;
    constructor(protected readonly kernel: IKernel) {
        // If user installs new python packages, & they restart the kernel, then look for changes to nbextensions folder once again.
        // No need to look for changes in nbextensions folder if its not restarted.
        // This is expected, jupyter nb/lab and other parts of Jupyter recommend users to restart kernels after installing python packages.
        kernel.onRestarted(this.onKernelRestarted, this, this.disposables);
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    abstract getBaseUrl(): Promise<Uri | undefined>;
    protected abstract getWidgetEntryPoints(): Promise<{ uri: Uri; widgetFolderName: string }[]>;
    protected abstract getWidgetScriptSource(source: Uri): Promise<string>;
    protected abstract getNbExtensionsParentPath(): Promise<Uri | undefined>;
    public async getWidgetModuleMappings(): Promise<Record<string, Uri> | undefined> {
        if (!this.widgetModuleMappings) {
            this.widgetModuleMappings = this.getWidgetModuleMappingsImpl();
        }
        return this.widgetModuleMappings;
    }
    protected onKernelRestarted() {
        this.widgetModuleMappings = undefined;
    }
    /**
     * Extracts the require.config configuration entry from the JS file.
     * Return value is basically the mapping for requirejs, which is as follows:
     * 'beakerx':'nbextensions/beakerx/index.js'
     * 'ipyvolume':'nbextensions/ipyvolume-widget/index.js'
     */
    async getConfigFromWidget(baseUrl: Uri, script: Uri, widgetFolderName: string) {
        const contents = await this.getWidgetScriptSource(script);

        try {
            const config = await extractRequireConfigFromWidgetEntry(baseUrl, widgetFolderName, contents);
            if (!config) {
                let message = `Failed to extract require.config from widget for ${widgetFolderName} from ${getDisplayPath(
                    script
                )}`;
                if (isCI) {
                    message += `with contents ${contents}`;
                }
                traceWarning(message);
            }
            traceInfoIfCI(
                `Extracted require.config entry for ${widgetFolderName} from ${getDisplayPath(
                    script
                )} for ${baseUrl.toString()} is ${JSON.stringify(config)}`
            );
            return config;
        } catch (ex) {
            traceError(
                `Failed to extract require.config entry for ${widgetFolderName} from ${getDisplayPath(script)}`,
                ex
            );
        }
    }
    private async getWidgetModuleMappingsImpl(): Promise<Record<string, Uri> | undefined> {
        const stopWatch = new StopWatch();
        const [entryPoints, baseUrl] = await Promise.all([
            this.getWidgetEntryPoints(),
            this.getNbExtensionsParentPath()
        ]);
        traceInfoIfCI(`Widget Entry points = ${JSON.stringify(entryPoints)}`);
        traceInfoIfCI(`Widget baseUrl = ${baseUrl?.toString()}`);
        if (!baseUrl) {
            return;
        }
        const widgetConfigs = await Promise.all(
            entryPoints.map((entry) => this.getConfigFromWidget(baseUrl, entry.uri, entry.widgetFolderName))
        );

        const config = widgetConfigs.reduce((prev, curr) => Object.assign(prev || {}, curr), {});
        // Exclude entries that are not required (widgets that we have already bundled with our code).
        if (config && Object.keys(config).length) {
            delete config['jupyter-js-widgets'];
            delete config['@jupyter-widgets/base'];
            delete config['@jupyter-widgets/controls'];
            delete config['@jupyter-widgets/output'];
        } else {
            traceInfoIfCI(
                `No config, entryPoints = ${JSON.stringify(entryPoints)}, widgetConfigs = ${JSON.stringify(
                    widgetConfigs
                )}`
            );
        }
        traceInfoIfCI(`Widget config = ${JSON.stringify(config)}`);
        sendTelemetryEvent(
            Telemetry.DiscoverIPyWidgetNamesPerf,
            { duration: stopWatch.elapsedTime },
            {
                type: isLocalConnection(this.kernel.kernelConnectionMetadata) ? 'local' : 'remote'
            }
        );
        return config && Object.keys(config).length ? config : undefined;
    }
}
