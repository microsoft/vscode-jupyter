// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { IProductService, Product, ProductType } from './types';

/**
 * Legacy code. Determines what type of installer to use for a product. We only have one, so we could probably eliminate this class.
 */
@injectable()
export class ProductService implements IProductService {
    private ProductTypes = new Map<Product, ProductType>();

    constructor() {
        this.ProductTypes.set(Product.jupyter, ProductType.DataScience);
        this.ProductTypes.set(Product.notebook, ProductType.DataScience);
        this.ProductTypes.set(Product.ipykernel, ProductType.DataScience);
        this.ProductTypes.set(Product.nbconvert, ProductType.DataScience);
        this.ProductTypes.set(Product.kernelspec, ProductType.DataScience);
        this.ProductTypes.set(Product.pandas, ProductType.DataScience);
        this.ProductTypes.set(Product.pip, ProductType.DataScience);
        this.ProductTypes.set(Product.ensurepip, ProductType.DataScience);
    }
    public getProductType(product: Product): ProductType {
        return this.ProductTypes.get(product)!;
    }
}
