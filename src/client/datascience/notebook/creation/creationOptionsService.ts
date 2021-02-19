// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensions } from '../../../common/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';

@injectable()
export class CreationOptionService {
    private _registrations: { extensionId: string; displayName: string; defaultCellLanguage: string }[] = [];
    constructor(@inject(IExtensions) private readonly extensions: IExtensions) {}
    public async registerNewNotebookContent(options: { defaultCellLanguage: string }): Promise<void> {
        const info = await this.extensions.determineExtensionFromCallStack();
        if (this._registrations.find((item) => item.extensionId.toLowerCase() === info.extensionId)) {
            return;
        }
        sendTelemetryEvent(Telemetry.OpenNotebookSelectionRegistered, undefined, { extensionId: info.extensionId });
        this._registrations.push({ ...info, ...options });
    }

    public get registrations() {
        return this._registrations;
    }
}
