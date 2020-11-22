import { createHash } from 'crypto';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import { Uri } from 'vscode';
import { traceError, traceInfo } from '../../common/logger';
import { isFileNotFoundError } from '../../common/platform/errors';
import { IFileSystem } from '../../common/platform/types';
import { IExtensionContext } from '../../common/types';
import { MigrateDigestStorage } from '../../migration/migrateDigestStorage';
import { IDigestStorage, ISystemPseudoRandomNumberGenerator } from '../types';

@injectable()
export class DigestStorage implements IDigestStorage {
    public readonly key: Promise<string | undefined>;
    private digestDir: Promise<string>;
    private loggedFileLocations = new Set();
    private migrator: MigrateDigestStorage;

    constructor(
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(ISystemPseudoRandomNumberGenerator) private prng: ISystemPseudoRandomNumberGenerator
    ) {
        this.migrator = new MigrateDigestStorage(extensionContext, fs);
        this.key = this.initKey();
        this.digestDir = this.initDir();
    }

    public async saveDigest(uri: Uri, signature: string) {
        const fileLocation = await this.getFileLocation(uri);
        // Since the signature is a hex digest, the character 'z' is being used to delimit the start and end of a single digest
        try {
            await this.saveDigestInner(uri, fileLocation, signature);
        } catch (err) {
            // The nbsignatures dir is only initialized on extension activation.
            // If the user deletes it to reset trust, the next attempt to trust
            // an untrusted notebook in the same session will fail because the parent
            // directory does not exist.
            if (isFileNotFoundError(err)) {
                // Gracefully recover from such errors by reinitializing directory and retrying
                await this.initDir();
                await this.saveDigestInner(uri, fileLocation, signature);
            } else {
                traceError(err);
            }
        }
    }

    public async containsDigest(uri: Uri, signature: string) {
        const fileLocation = await this.getFileLocation(uri);
        try {
            const digests = await this.fs.readLocalFile(fileLocation);
            return digests.indexOf(`z${signature}z`) >= 0;
        } catch (err) {
            if (!isFileNotFoundError(err)) {
                traceError(err); // Don't log the error if the file simply doesn't exist
            }
            return false;
        }
    }

    private async saveDigestInner(uri: Uri, fileLocation: string, signature: string) {
        await this.fs.appendLocalFile(fileLocation, `z${signature}z\n`);
        if (!this.loggedFileLocations.has(fileLocation)) {
            traceInfo(`Wrote trust for ${uri.toString()} to ${fileLocation}`);
            this.loggedFileLocations.add(fileLocation);
        }
    }

    private async getFileLocation(uri: Uri): Promise<string> {
        const normalizedName = os.platform() === 'win32' ? uri.fsPath.toLowerCase() : uri.fsPath;
        const hashedName = createHash('sha256').update(normalizedName).digest('hex');
        return path.join(await this.digestDir, hashedName);
    }

    private async initDir(): Promise<string> {
        await this.migrator.migrateDir();
        const defaultDigestDirLocation = this.getDefaultLocation('nbsignatures');
        if (!(await this.fs.localDirectoryExists(defaultDigestDirLocation))) {
            await this.fs.createLocalDirectory(defaultDigestDirLocation);
        }
        return defaultDigestDirLocation;
    }

    /**
     * Get or create a local secret key, used in computing HMAC hashes of trusted
     * checkpoints in the notebook's execution history
     */
    private async initKey(): Promise<string | undefined> {
        try {
            await this.migrator.migrateKey();
            const defaultKeyFileLocation = this.getDefaultLocation('nbsecret');

            if (await this.fs.localFileExists(defaultKeyFileLocation)) {
                // if the keyfile already exists, bail out
                const contents = await this.fs.readLocalFile(defaultKeyFileLocation);
                if (contents) {
                    traceInfo(`Found existing keyfile at ${defaultKeyFileLocation}`);
                    return contents;
                }
            }

            // If it doesn't exist, create one
            const key = await this.prng.generateRandomKey(1024);
            if (key) {
                traceInfo(`Successfully generated keyfile`);
                await this.fs.writeLocalFile(defaultKeyFileLocation, key);
                return key;
            } else {
                traceError('Failed to initialize secret for notebook trust');
            }
        } catch (e) {
            traceError(`Encountered error while initializing secret for notebook trust: ${e}`);
            return undefined;
        }
    }

    private getDefaultLocation(fileName: string) {
        const dir = this.extensionContext.globalStoragePath;
        if (dir) {
            return path.join(dir, fileName);
        }
        throw new Error('Unable to locate extension global storage path for trusted digest storage');
    }
}
