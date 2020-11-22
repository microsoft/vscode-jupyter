import { exec } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { inject, injectable } from 'inversify';
import { traceError, traceInfo } from '../../common/logger';
import { IPlatformService } from '../../common/platform/types';
import { OSType } from '../../common/utils/platform';
import { ISystemPseudoRandomNumberGenerator } from '../types';
import { EXTENSION_ROOT_DIR } from '../../constants';

// Wraps operating system-provided pseudorandom number generator facilities to provide
// cryptographically secure random bytes.
@injectable()
export class SystemPseudoRandomNumberGenerator implements ISystemPseudoRandomNumberGenerator {
    constructor(@inject(IPlatformService) private readonly platformService: IPlatformService) {}

    public async generateRandomKey(numBytes: number) {
        switch (this.platformService.osType) {
            case OSType.Windows:
                return this.randomBytesForWindows(numBytes);
            case OSType.Linux:
            case OSType.OSX:
                return this.randomBytesForUnixLikeSystems(numBytes);
            default:
                throw new Error('Cannot generate random bytes for unknown operating system.');
        }
    }

    // Run a small bundled executable which directly calls BCryptGenRandom and
    // outputs 1024 random bytes to stdout as a hex string.
    private async randomBytesForWindows(_numBytes: number): Promise<string> {
        // Ensure the exe is present. If it's not we can't generate bytes for Windows
        const executable = path.resolve(EXTENSION_ROOT_DIR, 'out', 'BCryptGenRandom', 'BCryptGenRandom.exe');
        await fs.stat(executable);
        return new Promise((resolve, reject) => {
            exec(executable, { encoding: 'buffer' }, (err, stdout, stderr) => {
                if (err) {
                    traceError(`${err}`);
                    reject(`Failed to allocate random bytes for notebook trust: ${err}`);
                }
                if (stderr.length > 0) {
                    traceError(stderr);
                }
                const key = stdout.toString('ascii');
                traceInfo(`Generated random key of length ${key.length}`);
                resolve(key);
            });
        });
    }

    // Read the first `numBytes` from /dev/urandom and return it as a hex-encoded string
    private async randomBytesForUnixLikeSystems(numBytes: number): Promise<string> {
        // Ensure urandom file is present. If it's not we can't generate bytes
        await fs.stat('/dev/urandom');
        return new Promise((resolve, reject) => {
            const script = `head -c ${numBytes} /dev/urandom`;
            traceInfo(`Executing script ${script} to generate random bytes`);
            exec(script, { encoding: 'buffer' }, (err, stdout, stderr) => {
                if (err) {
                    traceError(`${err}`);
                    reject(`Failed to allocate random bytes for notebook trust: ${err}`);
                }
                if (stderr.length > 0) {
                    traceError(stderr);
                }
                const key = stdout.toString('hex');
                traceInfo(`Generated random key of length ${key.length}`);
                resolve(key);
            });
        });
    }
}
