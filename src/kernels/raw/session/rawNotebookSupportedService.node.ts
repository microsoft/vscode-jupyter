// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { traceInfo, traceError, traceWarning } from '../../../platform/logging';
import { IConfigurationService } from '../../../platform/common/types';
import { IRawNotebookSupportedService } from '../types';

// This class check to see if we have everything in place to support a raw kernel launch on the machine
@injectable()
export class RawNotebookSupportedService implements IRawNotebookSupportedService {
    private _isSupported?: boolean;
    constructor(@inject(IConfigurationService) private readonly configuration: IConfigurationService) {}

    // Check to see if we have all that we need for supporting raw kernel launch
    public get isSupported(): boolean {
        return this.isSupportedForLocalLaunch();
    }

    private isSupportedForLocalLaunch(): boolean {
        // Save the ZMQ support for last, since it's probably the slowest part
        return !this.isZQMDisabled() && this.zmqSupported();
    }

    // Check to see if our hidden setting has been turned on to disable local ZMQ support
    private isZQMDisabled(): boolean {
        return this.configuration.getSettings().disableZMQSupport;
    }

    // Check to see if this machine supports our local ZMQ launching
    private zmqSupported(): boolean {
        if (typeof this._isSupported === 'boolean') {
            return this._isSupported;
        }
        if ((process.env.VSC_JUPYTER_NON_RAW_NATIVE_TEST || '').toLowerCase() === 'true') {
            return false;
        }
        try {
            require('zeromq');
            traceInfo(`ZMQ install verified.`);
            this._isSupported = true;
        } catch (e) {
            traceWarning(`Exception while attempting zmq :`, e);
            this._isSupported = false;
        }

        return this._isSupported;
    }
}
