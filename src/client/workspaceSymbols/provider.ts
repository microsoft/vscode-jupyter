'use strict';

// tslint:disable-next-line:no-var-requires no-require-imports
const flatten = require('lodash/flatten') as typeof import('lodash/flatten');
import {
    CancellationToken,
    Location,
    SymbolInformation,
    Uri,
    WorkspaceSymbolProvider as IWorspaceSymbolProvider
} from 'vscode';
import { IFileSystem } from '../common/platform/types';
import { captureTelemetry } from '../telemetry';
import { EventName } from '../telemetry/constants';
import { Generator } from './generator';
import { parseTags } from './parser';

export class WorkspaceSymbolProvider implements IWorspaceSymbolProvider {
    public constructor(private fs: IFileSystem, private tagGenerators: Generator[]) {}

    @captureTelemetry(EventName.WORKSPACE_SYMBOLS_GO_TO)
    public async provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<SymbolInformation[]> {
        if (this.tagGenerators.length === 0) {
            return [];
        }

        const generators: Generator[] = [];
        await Promise.all(
            this.tagGenerators.map(async (generator) => {
                if (await this.fs.fileExists(generator.tagFilePath)) {
                    generators.push(generator);
                }
            })
        );

        const promises = generators
            .filter((generator) => generator !== undefined && generator.enabled)
            .map(async (generator) => {
                // load tags
                const items = await parseTags(
                    generator!.workspaceFolder.fsPath,
                    generator!.tagFilePath,
                    query,
                    token,
                    this.fs
                );
                if (!Array.isArray(items)) {
                    return [];
                }
                return items.map(
                    (item) =>
                        new SymbolInformation(
                            item.symbolName,
                            item.symbolKind,
                            '',
                            new Location(Uri.file(item.fileName), item.position)
                        )
                );
            });

        const symbols = await Promise.all(promises);
        return flatten(symbols);
    }
}
