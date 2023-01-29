// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import * as path from '../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { IConfigurationService } from '../../platform/common/types';
import { IServiceContainer } from '../../platform/ioc/types';
import { IInstaller, IProductPathService, ModuleNamePurpose, Product } from './types';

/**
 * Determines if a product is a module or not
 */
export abstract class BaseProductPathsService implements IProductPathService {
    protected readonly configService: IConfigurationService;
    protected readonly productInstaller: IInstaller;
    constructor(protected serviceContainer: IServiceContainer) {
        this.configService = serviceContainer.get<IConfigurationService>(IConfigurationService);
        this.productInstaller = serviceContainer.get<IInstaller>(IInstaller);
    }
    public abstract getExecutableNameFromSettings(product: Product, resource?: Uri): string;
    public isExecutableAModule(product: Product, resource?: Uri): boolean {
        if (product === Product.kernelspec) {
            return false;
        }
        let moduleName: string | undefined;
        try {
            moduleName = this.productInstaller.translateProductToModuleName(product, ModuleNamePurpose.run);
            // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        } catch {}

        // User may have customized the module name or provided the fully qualified path.
        const executableName = this.getExecutableNameFromSettings(product, resource);

        return (
            typeof moduleName === 'string' && moduleName.length > 0 && path.basename(executableName) === executableName
        );
    }
}

@injectable()
export class DataScienceProductPathService extends BaseProductPathsService {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }
    public getExecutableNameFromSettings(product: Product, _?: Uri): string {
        return this.productInstaller.translateProductToModuleName(product, ModuleNamePurpose.run);
    }
}
