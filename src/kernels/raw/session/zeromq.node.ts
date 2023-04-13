// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../../platform/vscode-path/path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { traceInfo, traceVerbose, traceWarning } from '../../../platform/logging';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { noop } from '../../../platform/common/utils/misc';
import { DistroInfo, getDistroInfo } from '../../../platform/common/platform/linuxDistro.node';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import { Memento } from 'vscode';
import { getExtensionVersion } from '../../../platform/common/application/applicationEnvironment.base';

const VCRT_DLLS_COPIED_KEY = 'VCRT_DLLS_COPIED';

const zeromqModuleName = `${'zeromq'}`;
export function getZeroMQ(memento: Memento): typeof import('zeromq') {
    try {
        return loadZmqWithFallbackForWindows(
            zeromqModuleName,
            path.join(EXTENSION_ROOT_DIR, 'out', 'node_modules', 'zeromq'),
            false,
            memento
        );
    } catch (e) {
        try {
            return loadZmqWithFallbackForWindows(
                path.join(EXTENSION_ROOT_DIR, 'out', 'node_modules', 'zeromqold'),
                path.join(EXTENSION_ROOT_DIR, 'out', 'node_modules', 'zeromqold'),
                true,
                memento
            );
        } catch (e2) {
            sendZMQTelemetry(true, true, true, memento).catch(noop);
            traceWarning(`Exception while loading zmq :`, e.message || e); // No need to display the full stack (when this fails we know why if fails, hence a stack is not useful)
            traceWarning(`Exception while loading zmq (with the fallback) :`, e2.message || e2); // No need to display the full stack (when this fails we know why if fails, hence a stack is not useful)
            throw e2;
        }
    }
}

function loadZmqWithFallbackForWindows(
    zeromqModuleName: string,
    moduleDirectory: string,
    isFallback: boolean,
    memento: Memento
) {
    try {
        const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
        const zmq = requireFunc(zeromqModuleName);
        sendZMQTelemetry(false, isFallback, false, memento).catch(noop);
        traceInfo(`ZMQ loaded ${isFallback ? 'with' : 'without'} the fallback mechanism.`);
        return zmq;
    } catch (e) {
        traceVerbose(
            `Failed to load ZMQ ${isFallback ? 'with' : 'without'} the fallback from ${moduleDirectory} due to ${
                e.message || e
            }}`
        );
        if (os.platform() !== 'win32' || !moduleDirectory) {
            throw e;
        }
        // Special fallback for windows only.
        // Sometimes the vs runtime dlls do not exist on end user machine.
        // Try again by copying the files across.
        const dllsDir = path.join(EXTENSION_ROOT_DIR, 'out', 'node_modules', 'zeromq', 'vcrt');
        const targetDir = path.join(moduleDirectory, 'prebuilds', 'win32-x64');
        traceInfo(`Copying dlls from ${dllsDir} to ${targetDir}`);
        fs.copySync(dllsDir, targetDir, { overwrite: false });
        const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
        const zmq = requireFunc(zeromqModuleName);
        // Keep track of the version and the fact that it was copied (so that the telemetry sent later has accurate information).
        memento.update(VCRT_DLLS_COPIED_KEY, { copied: true, version: getExtensionVersion() }).then(noop, noop);
        sendZMQTelemetry(false, isFallback, true, memento).catch(noop);
        traceInfo(`ZMQ loaded after copying files, ${isFallback ? 'with' : 'without'} the fallback mechanism.`);
        return zmq;
    }
}
async function sendZMQTelemetry(failed: boolean, fallbackTried: boolean, vcRtCopied: boolean, memento: Memento) {
    const distro = await getDistroInfo().catch(() => <DistroInfo>{ id: '', version_id: '' });
    // Possible the dlls were copied in a previous session.
    const previouslyCopiedInfo = memento.get<{ copied: boolean; version: string }>(VCRT_DLLS_COPIED_KEY, {
        copied: false,
        version: ''
    });
    vcRtCopied = vcRtCopied || (previouslyCopiedInfo.copied && previouslyCopiedInfo.version === getExtensionVersion());
    const platformInfo = getPlatformInfo();
    sendTelemetryEvent(Telemetry.ZMQSupport, undefined, {
        distro_id: distro.id,
        distro_version_id: distro.version_id,
        failed,
        vcRtCopied,
        fallbackTried,
        alpine: platformInfo.alpine,
        libc: platformInfo.libc,
        armv: platformInfo.armv,
        zmqarch: platformInfo.zmqarch
    });
}
function isAlpine(platform: string) {
    return platform === 'linux' && fs.existsSync('/etc/alpine-release') ? true : false;
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
            alpine,
            libc: String(libc),
            armv: String(armv),
            zmqarch: arch
        };
    } catch (ex) {
        traceWarning(`Failed to determine platform information used to load zeromq binary.`, ex);
        return {};
    }
}
