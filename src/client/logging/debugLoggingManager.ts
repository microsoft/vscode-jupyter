import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import { Memento } from 'vscode';
import { IApplicationShell, ICommandManager } from '../common/application/types';
import { IFileSystem } from '../common/platform/types';
import { GLOBAL_MEMENTO, IConfigurationService, IExtensionContext, IMemento } from '../common/types';
import { Logging } from '../common/utils/localize';
import { Commands } from '../datascience/constants';
import { IDebugLoggingManager } from '../datascience/types';
import { addLogfile } from './_global';
import { LogLevel } from './levels';

const SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE = 'SeenDebugLogLevelAtLeastOnce';
const ASKED_ALREADY_FOR_LOG_LEVEL = 'AskedAlreadyAboutLogLevel';

@injectable()
export class DebugLoggingManager implements IDebugLoggingManager {
    private logfilePath: string;
    constructor(
        @inject(IFileSystem) private filesystem: IFileSystem,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: Memento,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IExtensionContext) private extensionContext: IExtensionContext
    ) {
        this.logfilePath = path.join(this.extensionContext.globalStorageUri.fsPath, 'log.txt');
    }

    public async initialize() {
        const logLevelSetting = this.configService.getSettings().logging.level;
        const seenDebugAtLeastOnce = this.globalState.get<boolean>(
            SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE,
            false
        );
        if (logLevelSetting === LogLevel.Debug && seenDebugAtLeastOnce) {
            await this.warnUserAboutLoggingToFile();
        } else if (logLevelSetting === LogLevel.Debug && !seenDebugAtLeastOnce) {
            await this.configureLoggingToFile();
        }
    }

    private async configureLoggingToFile() {
        await this.filesystem.writeLocalFile(this.logfilePath, ''); // Overwrite existing logfile if any
        addLogfile(this.logfilePath);
        void this.globalState.update(SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE, true);
    }

    private async warnUserAboutLoggingToFile() {
        const askedAlready = this.globalState.get<boolean>(ASKED_ALREADY_FOR_LOG_LEVEL, false);
        if (!askedAlready) {
            const prompt = Logging.bannerYesTurnOffDebugLogging();
            const no = Logging.NoResponse();
            const dontAskAgain = Logging.NoAndDontAskAgain();
            void this.appShell
                .showWarningMessage(Logging.warnUserAboutDebugLoggingSetting(), ...[prompt, no, dontAskAgain])
                .then((selection) => {
                    if (selection === prompt) {
                        void this.commandManager.executeCommand(Commands.ResetLoggingLevel);
                    } else if (selection === dontAskAgain) {
                        void this.globalState.update(ASKED_ALREADY_FOR_LOG_LEVEL, true);
                    }
                });
        }
        await this.configureLoggingToFile();
    }
}
