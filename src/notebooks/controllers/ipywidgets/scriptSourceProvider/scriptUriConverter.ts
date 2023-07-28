// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { ILocalResourceUriConverter } from '../types';

/**
 * Converts the uri of a widget script for loading in a vscode webview
 */
export class ScriptUriConverter implements ILocalResourceUriConverter {
    constructor(
        private readonly isWebExtension: boolean,
        private readonly converter: (input: Uri) => Promise<Uri>
    ) {}

    /**
     * This method is called to convert a Uri to a format such that it can be used in a webview.
     * Some times we have resources in the extension/tmp folder that contain static resources such as JS, image files and the like.
     * The webview can load them, however the Uri needs to be in a special format for that to work.
     * Note: Currently this is only use for Jupyter Widgets.
     */
    public async asWebviewUri(resource: Uri): Promise<Uri> {
        // In the case of web extension, we don't have any local resources, everything is served remotely either via
        // remote jupyter server or via a web extension.
        // Hence no need to transform the uri in web extension.
        return this.isWebExtension ? resource : this.converter(resource);
    }
}
