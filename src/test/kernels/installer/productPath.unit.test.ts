// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as TypeMoq from 'typemoq';
import { Memento, Uri } from 'vscode';
import '../../../platform/common/extensions';
import { IConfigurationService, IOutputChannel } from '../../../platform/common/types';
import { InterpreterPackages } from '../../../platform/interpreter/interpreterPackages.node';
import { IServiceContainer } from '../../../platform/ioc/types';
import { ProductInstaller } from '../../../kernels/installer/productInstaller.node';
import { BaseProductPathsService } from '../../../kernels/installer/productPath.node';
import { ProductService } from '../../../kernels/installer/productService.node';
import { Product, ProductType, IInstaller, IProductService } from '../../../kernels/installer/types';
import { getNamesAndValues } from '../../../test/utils/enum';

use(chaiAsPromised);

suite('Product Path', () => {
    getNamesAndValues<Product>(Product).forEach((product) => {
        class TestBaseProductPathsService extends BaseProductPathsService {
            public getExecutableNameFromSettings(_: Product, _resource?: Uri): string {
                return '';
            }
        }
        let serviceContainer: TypeMoq.IMock<IServiceContainer>;
        let configService: TypeMoq.IMock<IConfigurationService>;
        let productInstaller: ProductInstaller;
        let interpreterPackages: TypeMoq.IMock<InterpreterPackages>;
        let outputChannel: TypeMoq.IMock<IOutputChannel>;
        let memento: TypeMoq.IMock<Memento>;
        setup(function () {
            if (new ProductService().getProductType(product.value) === ProductType.DataScience) {
                return this.skip();
            }
            serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
            configService = TypeMoq.Mock.ofType<IConfigurationService>();
            interpreterPackages = TypeMoq.Mock.ofType<InterpreterPackages>();
            outputChannel = TypeMoq.Mock.ofType<IOutputChannel>();
            memento = TypeMoq.Mock.ofType<Memento>();

            productInstaller = new ProductInstaller(
                serviceContainer.object,
                interpreterPackages.object,
                memento.object,
                outputChannel.object
            );
            serviceContainer
                .setup((s) => s.get(TypeMoq.It.isValue(IConfigurationService), TypeMoq.It.isAny()))
                .returns(() => configService.object);
            serviceContainer
                .setup((s) => s.get(TypeMoq.It.isValue(IInstaller), TypeMoq.It.isAny()))
                .returns(() => productInstaller);
            serviceContainer
                .setup((c) => c.get(TypeMoq.It.isValue(IProductService), TypeMoq.It.isAny()))
                .returns(() => new ProductService());
        });

        suite('Method isExecutableAModule()', () => {
            test('Returns true if User has customized the executable name', () => {
                productInstaller.translateProductToModuleName = () => 'moduleName';
                const productPathService = new TestBaseProductPathsService(serviceContainer.object);
                productPathService.getExecutableNameFromSettings = () => 'executableName';
                expect(productPathService.isExecutableAModule(product.value)).to.equal(true, 'Should be true');
            });
            test('Returns false if User has customized the full path to executable', () => {
                productInstaller.translateProductToModuleName = () => 'moduleName';
                const productPathService = new TestBaseProductPathsService(serviceContainer.object);
                productPathService.getExecutableNameFromSettings = () => 'path/to/executable';
                expect(productPathService.isExecutableAModule(product.value)).to.equal(false, 'Should be false');
            });
            test('Returns false if translating product to module name fails with error', () => {
                productInstaller.translateProductToModuleName = () => {
                    return new Error('Kaboom') as any;
                };
                const productPathService = new TestBaseProductPathsService(serviceContainer.object);
                productPathService.getExecutableNameFromSettings = () => 'executableName';
                expect(productPathService.isExecutableAModule(product.value)).to.equal(false, 'Should be false');
            });
        });
    });
});
