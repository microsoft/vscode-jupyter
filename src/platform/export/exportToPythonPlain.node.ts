import { inject, injectable } from 'inversify';
import * as os from 'os';
import { IFileSystem } from '../common/platform/types';
import { IConfigurationService } from '../common/types';
import { ExportToPythonPlainBase } from './exportToPythonPlain';

// Handles exporting a NotebookDocument to python
@injectable()
export class ExportToPythonPlain extends ExportToPythonPlainBase {
    public constructor(
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IConfigurationService) configuration: IConfigurationService
    ) {
        super(fs, configuration);
    }

    override getEOL(): string {
        return os.EOL;
    }
}
