// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { Resource } from '../../platform/common/types';

import { IInterpreterQuickPickItem, IInterpreterSelector } from '../../platform/interpreter/configuration/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';

@injectable()
export class InterpreterSelector implements IInterpreterSelector {
    constructor(@inject(IInterpreterService) private readonly interpreterService: IInterpreterService) {}

    public async getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem[]> {
        const interpreters = await this.interpreterService.getInterpreters(resource);
        return interpreters.map((item) => {
            const filePath = getDisplayPath(item.uri);
            return {
                label: item.displayName || filePath,
                description: item.displayName || filePath,
                detail: item.displayName || filePath,
                path: filePath,
                interpreter: item
            };
        });
    }
}
