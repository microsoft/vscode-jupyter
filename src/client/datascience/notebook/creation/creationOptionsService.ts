// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensions } from '../../../common/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';

@injectable()
export class CreationOptionService {
    private readonly _registrations: { extensionId: string; displayName: string; defaultCellLanguage: string }[] = [];
    constructor(@inject(IExtensions) private readonly extensions: IExtensions) {}
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
