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
export async function getZeroMQ(): Promise<typeof import('zeromq')> {
    try {
        const zmq: typeof import('zeromq') = await import(zeromqModuleName);
        // We do not want to block the process from exiting if there are any pending messages.
        zmq.context.blocky = false;
        sendZMQTelemetry(false).catch(noop);
        return zmq;
    } catch (e) {
        try {
            const zmq = require(path.join(EXTENSION_ROOT_DIR, 'dist', 'node_modules', 'zeromqold'));
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
/**
 * We need to send telemetry to understand how many users are failing to load the binaries.
 * Its possible they have installed the wrong extension or the files do not exist or the like.
 * This is required to ensure kernels run successfully (by understanding the cause of the failures).
 */
async function getLocalZmqBinaries() {
    try {
        const zmqFolder = path.join(EXTENSION_ROOT_DIR, 'dist', 'node_modules', 'zeromq', 'prebuilds');
        if (!(await fs.pathExists(path.join(EXTENSION_ROOT_DIR, 'dist', 'node_modules')))) {
            // We're in dev mode.
            return;
        }
        const filesPromises = await fs.readdir(zmqFolder).then((folders) =>
            folders.map(async (folder) => {
                const folderPath = path.join(zmqFolder, folder);
                const stat = await fs.stat(folderPath);
                if (stat.isDirectory()) {
                    return fs.readdir(folderPath).then((files) => files.map((file) => path.join(folderPath, file)));
                }
                return [];
            })
        );
        const files = (await Promise.all(filesPromises.flat())).flat();
        return files.map((file) =>
            file
                .substring(file.lastIndexOf('prebuilds') + 'prebuilds'.length + 1)
                .replace(/\\/g, '<sep>')
                .replace(/\//g, '<sep>')
        );
    } catch (ex) {
        traceWarning(`Failed to determine local zmq binaries.`, ex);
        return ['Failed to determine local zmq binaries.'];
    }
}
let telemetrySentOnce = false;
async function sendZMQTelemetry(
    failed: boolean,
    fallbackTried: boolean = false,
    errorMessage = '',
    fallbackErrorMessage = ''
) {
    if (telemetrySentOnce) {
        return;
    }
    telemetrySentOnce = true;
    const [distro, zmqBinaries] = await Promise.all([
        getDistroInfo().catch(() => <DistroInfo>{ id: '', version_id: '' }),
        getLocalZmqBinaries()
    ]);
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
        zmqBinaries,
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
