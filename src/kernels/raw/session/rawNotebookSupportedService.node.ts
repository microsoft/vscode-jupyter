// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as os from 'os';
import { inject, injectable } from 'inversify';
import { traceWarning } from '../../../platform/logging';
import { IConfigurationService } from '../../../platform/common/types';
import { IRawNotebookSupportedService } from '../types';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { noop } from '../../../platform/common/utils/misc';
import { DistroInfo, getDistroInfo } from '../../../platform/common/platform/linuxDistro.node';

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
            this._isSupported = true;
            sendZMQTelemetry(true).catch(noop);
        } catch (e) {
            sendZMQTelemetry(false).catch(noop);
            traceWarning(`Exception while attempting zmq :`, e.message || e); // No need to display the full stack (when this fails we know why if fails, hence a stack is not useful)
            this._isSupported = false;
        }

        return this._isSupported;
    }
}
async function sendZMQTelemetry(failed: boolean) {
    const info = await getDistroInfo().catch(() => <DistroInfo>{ name: '', id: '', version: '', version_id: '' });

    const telemetryInfo = {
        ...getPlatformInfo(),
        distro_name: info.name,
        distro_id: info.id,
        distro_version: info.version,
        distro_version_id: info.version_id,
        failed
    };
    sendTelemetryEvent(Telemetry.ZMQSupport, undefined, telemetryInfo);
}
function isAlpine(platform: string) {
    return platform === 'linux' && fs.existsSync('/etc/alpine-release');
}

/**
 * Gets the current platform details that are used to determine the correct
 * version of zmq binary to be loaded.
 * Source from node_modules/@aminya/node-gyp-build/index.js
 * (@aminya/node-gyp-build is what is used by zeromq.js)
 */
function getPlatformInfo() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vars: Record<string, any> = (process.config && process.config.variables) || {};
        const arch = process.env.npm_config_arch || os.arch();
        const platform = process.env.npm_config_platform || os.platform();
        const alpine = isAlpine(platform);
        const libc = process.env.LIBC || (isAlpine(platform) ? 'musl' : 'glibc');
        const armv = process.env.ARM_VERSION || (arch === 'arm64' ? '8' : vars.arm_version) || '';

        return {
            alpine: alpine,
            libc: String(libc),
            armv: String(armv)
        };
    } catch (ex) {
        traceWarning(`Failed to determine platform information used to load zeromq binary.`, ex);
        return {};
    }
}
