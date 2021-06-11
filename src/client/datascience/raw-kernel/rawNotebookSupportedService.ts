// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { IS_NON_RAW_NATIVE_TEST } from '../../../test/constants';
import { traceError, traceInfo } from '../../common/logger';
import { IConfigurationService } from '../../common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { Settings, Telemetry } from '../constants';
import { IRawNotebookSupportedService } from '../types';

// This class check to see if we have everything in place to support a raw kernel launch on the machine
@injectable()
export class RawNotebookSupportedService implements IRawNotebookSupportedService {
    private isSupported?: boolean;
    constructor(@inject(IConfigurationService) private readonly configuration: IConfigurationService) {}

    // Check to see if we have all that we need for supporting raw kernel launch
    public supported(): boolean {
        if (!this.localLaunch()) {
            return false;
        }
        return this.isSupportedForLocalLaunch();
    }

    private isSupportedForLocalLaunch(): boolean {
        // Save the ZMQ support for last, since it's probably the slowest part
        return !this.isZQMDisabled() && this.zmqSupported();
    }

    private localLaunch(): boolean {
        const settings = this.configuration.getSettings(undefined);
        const serverType: string | undefined = settings.jupyterServerType;

        if (!serverType || serverType.toLowerCase() === Settings.JupyterServerLocalLaunch) {
            return true;
        }

        return false;
    }

    // Check to see if our hidden setting has been turned on to disable local ZMQ support
    private isZQMDisabled(): boolean {
        return this.configuration.getSettings().disableZMQSupport;
    }

    // Check to see if this machine supports our local ZMQ launching
    private zmqSupported(): boolean {
        if (typeof this.isSupported === 'boolean') {
            return this.isSupported;
        }
        if (IS_NON_RAW_NATIVE_TEST) {
            return false;
        }
        try {
            require('zeromq');
            traceInfo(`ZMQ install verified.`);
            sendTelemetryEvent(Telemetry.ZMQSupported);
            this.isSupported = true;
        } catch (e) {
            traceError(`Exception while attempting zmq :`, e);
            sendTelemetryEvent(Telemetry.ZMQNotSupported);
            this.isSupported = false;
        }

        return this.isSupported;
    }
}
