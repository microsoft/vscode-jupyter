import { exec } from 'child_process';
import * as fs from 'fs-extra';
import { inject, injectable } from 'inversify';
import { traceError, traceInfo } from '../../common/logger';
import { IPlatformService } from '../../common/platform/types';
import { OSType } from '../../common/utils/platform';
import { ISystemPseudoRandomNumberGenerator } from '../types';

// Wraps operating system-provided pseudorandom number generator facilities to provide
// cryptographically secure random bytes.
@injectable()
export class SystemPseudoRandomNumberGenerator implements ISystemPseudoRandomNumberGenerator {
    constructor(@inject(IPlatformService) private readonly platformService: IPlatformService) {}

    public async randomBytes(numBytes: number) {
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

    // Calls into BCryptGenRandom in bcrypt.dll using node-ffi
    // See https://github.com/node-ffi/node-ffi/wiki/Node-FFI-Tutorial for details on usage
    private randomBytesForWindows(numBytes: number) {
        try {
            // tslint:disable: no-require-imports
            // Lazy-load modules required for calling BCryptGenRandom
            const ffi = require('ffi-napi') as typeof import('ffi-napi');
            const ref = require('ref-napi');

            const BCRYPT_ALG_HANDLE = 'void*';
            const ULONG = 'uint';
            const PUCHAR = 'pointer';
            const NTSTATUS = ref.types.uint32;

            traceInfo('Initializing FFI bindings for BCryptGenRandom...');
            const bcryptlib = ffi.Library('BCrypt', {
                // Name of DLL function: [ return type, [ arg1 type, arg2 type, ... ] ]
                // https://docs.microsoft.com/en-us/windows/win32/api/bcrypt/nf-bcrypt-bcryptgenrandom
                BCryptGenRandom: [NTSTATUS, [BCRYPT_ALG_HANDLE, PUCHAR, ULONG, ULONG]]
            });

            traceInfo('Calling BCryptGenRandom to generate random bytes...');
            const pbBuffer = Buffer.alloc(numBytes);
            const statusCodeForBCryptGenRandom = bcryptlib.BCryptGenRandom(ref.NULL, pbBuffer, numBytes, 2);
            if (statusCodeForBCryptGenRandom !== 0) {
                traceError(
                    `Failed to allocate random bytes with BCryptGenRandom with exit status ${statusCodeForBCryptGenRandom}.`
                );
                throw new Error('Failed to allocate random bytes for notebook trust.');
            }

            return pbBuffer;
        } catch (e) {
            traceError(e);
            throw new Error('Failed to allocate random bytes for notebook trust.');
        }
    }

    // Read the first `numBytes` from /dev/urandom
    private async randomBytesForUnixLikeSystems(numBytes: number): Promise<Buffer> {
        await fs.stat('/dev/urandom'); // Ensure file is present. If it's not we can't generate bytes
        return new Promise((resolve, reject) => {
            const script = `head -c ${numBytes} /dev/urandom`;
            traceInfo(`Executing script ${script} to generate random bytes`);
            exec(script, { encoding: 'buffer' }, (err, stdout, stderr) => {
                if (err) {
                    traceError(`${err}`);
                    reject(err);
                }
                if (stderr.length > 0) {
                    traceError(stderr);
                }
                resolve(stdout);
            });
        });
    }
}
