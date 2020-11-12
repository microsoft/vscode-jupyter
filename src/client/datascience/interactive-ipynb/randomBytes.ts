import * as ffi from 'ffi-napi';
import { inject, injectable } from 'inversify';
import * as ref from 'ref-napi';
import { traceError, traceInfo } from '../../common/logger';
import { IFileSystem, IPlatformService } from '../../common/platform/types';
import { IProcessServiceFactory } from '../../common/process/types';
import { OSType } from '../../common/utils/platform';
import { ISystemPseudoRandomNumberGenerator } from '../types';

// Wraps operating system-provided pseudorandom number generator facilities to provide
// cryptographically secure random bytes.
@injectable()
export class SystemPseudoRandomNumberGenerator implements ISystemPseudoRandomNumberGenerator {
    constructor(
        @inject(IPlatformService) private readonly platformService: IPlatformService,
        @inject(IProcessServiceFactory) private readonly processServiceFactory: IProcessServiceFactory,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem
    ) {}

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
    }

    // Read the first `numBytes` from /dev/urandom
    private async randomBytesForUnixLikeSystems(numBytes: number) {
        const temporaryFile = await this.fileSystem.createTemporaryLocalFile('.txt');
        const script = `head -c ${numBytes} /dev/urandom > ${temporaryFile.filePath}`;
        const process = await this.processServiceFactory.create();

        traceInfo(`Executing ${script} to generate random bytes...`);
        const executionResult = await process.shellExec(script);
        if (executionResult.stderr) {
            traceError(executionResult.stderr);
            throw new Error('Failed to allocate random bytes for notebook trust.');
        }
        if (executionResult.stdout) {
            traceInfo(executionResult.stdout);
        }
        return this.fileSystem.readLocalData(temporaryFile.filePath);
    }
}
