// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { traceError } from '../../../common/logger';
import { IExtensions } from '../../../common/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';

@injectable()
export class CreationOptionService {
    private readonly _registrations: { extensionId: string; displayName: string; defaultCellLanguage: string }[] = [];
    constructor(@inject(IExtensions) private readonly extensions: IExtensions) {
        const contributingExtensions = extensions.all.filter((item) =>
            item.packageJSON.contributes && item.packageJSON.contributes['jupyter.kernels'] ? true : false
        );
        contributingExtensions.forEach((ext) => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ext.packageJSON.contributes['jupyter.kernels'].forEach((kernel: any) => {
                    this._registrations.push({
                        extensionId: ext.id,
                        displayName: kernel['title'],
                        defaultCellLanguage: kernel['defaultlanguage']
                    });
                });
            } catch {
                traceError(`${ext.id} is not contributing jupyter kernels as expected.`);
            }
        });
    }
    public async registerNewNotebookContent(options: { defaultCellLanguage: string; label?: string }): Promise<void> {
        const info = await this.extensions.determineExtensionFromCallStack();
        if (this._registrations.find((item) => item.extensionId.toLowerCase() === info.extensionId)) {
            return;
        }
        sendTelemetryEvent(Telemetry.OpenNotebookSelectionRegistered, undefined, { extensionId: info.extensionId });
        this._registrations.push({ ...info, ...options, displayName: options.label || info.displayName });
    }
    public get registrations() {
        return this._registrations;
    }

    /**
     * Only used during test.
     */
    public clear() {
        this._registrations.splice(0, this._registrations.length);
    }
}
