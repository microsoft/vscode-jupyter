// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import * as os from 'os';
import { traceInfo, traceWarning } from '../../../platform/logging';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { noop } from '../../../platform/common/utils/misc';
import { DistroInfo, getDistroInfo } from '../../../platform/common/platform/linuxDistro.node';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
const zeromqModuleName = `${'zeromq'}`;
export function getZeroMQ(): typeof import('zeromq') {
    try {
        const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
        const zmq = requireFunc(zeromqModuleName);
        sendZMQTelemetry(false).catch(noop);
        return zmq;
    } catch (e) {
        try {
            const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
            const zmq = requireFunc(path.join(EXTENSION_ROOT_DIR, 'out', 'node_modules', 'zeromqold'));
            traceInfo('ZMQ loaded via fallback mechanism.');
            sendZMQTelemetry(false, true, e.message || e.toString()).catch(noop);
            return zmq;
        } catch (e2) {
            sendZMQTelemetry(true, true, e.message || e.toString(), e2.message || e2.toString()).catch(noop);
            traceWarning(`Exception while attempting zmq :`, e.message || e); // No need to display the full stack (when this fails we know why if fails, hence a stack is not useful)
            traceWarning(`Exception while attempting zmq (fallback) :`, e2.message || e2); // No need to display the full stack (when this fails we know why if fails, hence a stack is not useful)
            throw e2;
        }
    }
}

async function sendZMQTelemetry(
    failed: boolean,
    fallbackTried: boolean = false,
    errorMessage = '',
    fallbackErrorMessage = ''
) {
    const distro = await getDistroInfo().catch(() => <DistroInfo>{ id: '', version_id: '' });
    const platformInfo = getPlatformInfo();
    sendTelemetryEvent(Telemetry.ZMQSupport, undefined, {
        distro_id: distro.id,
        distro_version_id: distro.version_id,
        failed,
        fallbackTried,
        alpine: platformInfo.alpine,
        libc: platformInfo.libc,
        armv: platformInfo.armv,
        zmqarch: platformInfo.zmqarch
    });
    sendTelemetryEvent(Telemetry.ZMQSupportFailure, undefined, {
        distro_id: distro.id,
        distro_version_id: distro.version_id,
        failed,
        fallbackTried,
        alpine: platformInfo.alpine,
        libc: platformInfo.libc,
        armv: platformInfo.armv,
        zmqarch: platformInfo.zmqarch,
        errorMessage,
        fallbackErrorMessage
    });
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
        const npmConfigArch = (process.env.npm_config_arch || '').trim();
        const arch = npmConfigArch || os.arch();
        const platform = process.env.npm_config_platform || os.platform();
        const alpine = isAlpine(platform);
        const libc = process.env.LIBC || (isAlpine(platform) ? 'musl' : 'glibc');
        const armv = process.env.ARM_VERSION || (arch === 'arm64' ? '8' : vars.arm_version) || '';

        return {
            alpine: alpine,
            libc: String(libc),
            armv: String(armv),
            zmqarch: arch
        };
    } catch (ex) {
        traceWarning(`Failed to determine platform information used to load zeromq binary.`, ex);
        return {};
    }
}
