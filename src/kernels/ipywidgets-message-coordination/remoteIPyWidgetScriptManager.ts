// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import * as path from '../../platform/vscode-path/path';
import * as dedent from 'dedent';
import { Uri } from 'vscode';
import { IHttpClient } from '../../platform/common/types';
import { traceError } from '../../platform/logging';
import { executeSilently, isPythonKernelConnection } from '../helpers';
import { IKernel, RemoteKernelConnectionMetadata } from '../types';
import { IIPyWidgetScriptManager } from './types';
import { BaseIPyWidgetScriptManager } from './baseIPyWidgetScriptManager';

export class RemoteIPyWidgetScriptManager extends BaseIPyWidgetScriptManager implements IIPyWidgetScriptManager {
    private readonly kernelConnection: RemoteKernelConnectionMetadata;
    constructor(kernel: IKernel, private readonly httpClient: IHttpClient) {
        super(kernel);
        if (
            kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel' &&
            kernel.kernelConnectionMetadata.kind !== 'startUsingRemoteKernelSpec'
        ) {
            throw new Error('Invalid usage, can only be used for remote kernels');
        }
        this.kernelConnection = kernel.kernelConnectionMetadata;
    }
    public getBaseUrl() {
        return this.getNbExtensionsParentPath();
    }
    public async getNbExtensionsParentPath() {
        return Uri.parse(this.kernelConnection.baseUrl);
    }
    protected async getWidgetEntryPoints() {
        // If we're connected to a non-python kernel, then assume we don't have 3rd party widget script sources for now.
        // If we do, we can get this later on by starting a python kernel.
        if (!isPythonKernelConnection(this.kernelConnection)) {
            return [];
        }

        const code = dedent`
                            import sys
                            import os
                            try:
                                __vsc_glob_was_imported = 'glob' in sys.modules
                                __vsc_os_was_imported = 'os' in sys.modules
                                __vsc_nbextension_widgets = []
                                import glob
                                import os
                                __vsc_nbextension_Folder = sys.prefix + os.path.sep + 'share' + os.path.sep + 'jupyter' + os.path.sep + 'nbextensions' + os.path.sep
                                for file in glob.glob(__vsc_nbextension_Folder + '*' +  os.path.sep + 'extension.js'):
                                    __vsc_nbextension_widgets.append(file.replace(__vsc_nbextension_Folder, ""))

                                print(__vsc_nbextension_widgets)
                            except:
                                pass

                            try:
                                if not __vsc_glob_was_imported:
                                    del sys.modules['glob']
                                if not __vsc_os_was_imported:
                                    del sys.modules['os']
                            except:
                                pass

                            del __vsc_glob_was_imported
                            del __vsc_os_was_imported
                            del __vsc_nbextension_Folder
                            del __vsc_nbextension_widgets`;
        if (!this.kernel.session) {
            return [];
        }
        const outputs = await executeSilently(this.kernel.session, code);
        if (outputs.length === 0) {
            return [];
        }
        const output = outputs[0] as nbformat.IStream;
        if (output.output_type !== 'stream' || output.name !== 'stdout') {
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
