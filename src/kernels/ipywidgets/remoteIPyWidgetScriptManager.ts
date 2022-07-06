// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import * as path from '../../platform/vscode-path/path';
import dedent from 'dedent';
import { ExtensionMode, Uri } from 'vscode';
import { IExtensionContext, IHttpClient } from '../../platform/common/types';
import { traceError, traceInfoIfCI } from '../../platform/logging';
import { executeSilently, isPythonKernelConnection } from '../helpers';
import { IKernel, RemoteKernelConnectionMetadata } from '../types';
import { IIPyWidgetScriptManager } from './types';
import { BaseIPyWidgetScriptManager } from './baseIPyWidgetScriptManager';
import { isCI } from '../../platform/common/constants';
import { sleep } from '../../platform/common/utils/async';
import { noop } from '../../platform/common/utils/misc';

export class RemoteIPyWidgetScriptManager extends BaseIPyWidgetScriptManager implements IIPyWidgetScriptManager {
    private readonly kernelConnection: RemoteKernelConnectionMetadata;
    private widgetEntryPointsPromise?: Promise<{ uri: Uri; widgetFolderName: string }[]>;
    constructor(
        kernel: IKernel,
        private readonly httpClient: IHttpClient,
        private readonly context: IExtensionContext
    ) {
        super(kernel);
        if (
            kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel' &&
            kernel.kernelConnectionMetadata.kind !== 'startUsingRemoteKernelSpec'
        ) {
            throw new Error('Invalid usage, can only be used for remote kernels');
        }
        this.kernelConnection = kernel.kernelConnectionMetadata;
        this.getWidgetEntryPoints().catch(noop);
    }
    public getBaseUrl() {
        return this.getNbExtensionsParentPath();
    }
    public async getNbExtensionsParentPath() {
        return Uri.parse(this.kernelConnection.baseUrl);
    }
    protected override onKernelRestarted(): void {
        this.widgetEntryPointsPromise = undefined;
        super.onKernelRestarted();
    }
    protected async getWidgetEntryPoints() {
        if (!this.widgetEntryPointsPromise) {
            this.widgetEntryPointsPromise = this.getWidgetEntryPointsImpl();
        }
        return this.widgetEntryPointsPromise;
    }
    private async getWidgetEntryPointsImpl() {
        // If we're connected to a non-python kernel, then assume we don't have 3rd party widget script sources for now.
        // If we do, we can get this later on by starting a python kernel.
        if (!isPythonKernelConnection(this.kernelConnection)) {
            return [];
        }

        const code = dedent`
                            __vsc_nbextension_widgets = []
                            __vsc_file = ''
                            __vsc_nbextension_Folder = ''
                            import glob as _VSCODE_glob
                            import os as _VSCODE_os
                            import sys as _VSCODE_sys
                            try:
                                __vsc_nbextension_Folder = _VSCODE_sys.prefix + _VSCODE_os.path.sep + 'share' + _VSCODE_os.path.sep + 'jupyter' + _VSCODE_os.path.sep + 'nbextensions' + _VSCODE_os.path.sep
                                for __vsc_file in _VSCODE_glob.glob(__vsc_nbextension_Folder + '*' +  _VSCODE_os.path.sep + 'extension.js'):
                                    __vsc_nbextension_widgets.append(__vsc_file.replace(__vsc_nbextension_Folder, ""))

                                print(__vsc_nbextension_widgets)
                            except:
                                pass

                            # We need to ensure these variables don't interfere with the variable viewer, hence delete them after use.
                            del _VSCODE_glob
                            del _VSCODE_os
                            del _VSCODE_sys
                            del __vsc_file
                            del __vsc_nbextension_Folder
                            del __vsc_nbextension_widgets`;
        if (!this.kernel.session) {
            traceInfoIfCI('No Kernel session to get list of widget entry points');
            return [];
        }
        const promises: Promise<nbformat.IOutput[]>[] = [];
        promises.push(
            executeSilently(this.kernel.session, code, {
                traceErrors: true,
                traceErrorsMessage: 'Failed to get widget entry points from remote kernel'
            })
        );
        // A bug was identified in our code that resulted in a deadlock.
        // While the widgets are loading this code gets executed, however the kernel execution is blocked waiting for kernel messages to be completed on the UI side
        // This is how we synchronize messages between the UI and kernel - i.e. we wait for kernel messages to be handled completely.
        // Hence if UI is still busy waiting for widget to load, the kernel message is also waiting to be completed, & if
        // we sent another request, that will get queued.
        // On CI & dev, lets wait, but in production, lets not break user code, worst case widget might not work.
        // Thats fine as up until this fix widget would never have worked without CDN.
        // See here for issue details https://github.com/microsoft/vscode-jupyter/issues/10510
        if (!isCI && this.context.extensionMode === ExtensionMode.Production) {
            // If we're on CI or in dev mode/testing, we'll block indefinitely so that we see these deadlocks
            // 10s is enough as this shouldn't take more than 10 seconds in the real world.
            promises.push(sleep(10_000).then(() => [] as nbformat.IOutput[]));
        }
        // We don't want any unhandled promises.
        promises.forEach((promise) => promise.catch(noop));

        const outputs = await Promise.race(promises);
        if (outputs.length === 0) {
            traceInfoIfCI('Unable to get widget entry points, no outputs after running the code');
            return [];
        }
        const output = outputs[0] as nbformat.IStream;
        if (output.output_type !== 'stream' || output.name !== 'stdout') {
            traceInfoIfCI('Unable to get widget entry points, no stream/stdout outputs after running the code');
            return [];
        }
        try {
            // Value will be an array of the form `['xyz', 'abc']`
            const items = (output.text as string)
                .trim()
                .substring(1) // Trim leading `[`
                .slice(0, -1) // Trim trailing `]`
                .split(',')
                .map((item) => item.trim().trimQuotes());
            return items.map((item) => ({
                uri: Uri.joinPath(Uri.parse(this.kernelConnection.baseUrl), 'nbextensions', item),
                widgetFolderName: path.dirname(item)
            }));
        } catch (ex) {
            traceError(`Failed to parse output to get list of IPyWidgets, output is ${output.text}`, ex);
            return [];
        }
    }
    protected async getWidgetScriptSource(script: Uri): Promise<string> {
        const uri = script.toString();

        const response = await this.httpClient.downloadFile(uri);
        if (response.status === 200) {
            return response.text();
        } else {
            traceError(`Error downloading from ${uri}: ${response.statusText}`);
            throw new Error(`Error downloading from ${uri}: ${response.statusText}`);
        }
    }
}
