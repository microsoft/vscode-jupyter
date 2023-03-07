// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Memento, Uri } from 'vscode';
import { ProductNames } from './productNames';
import { Product } from './types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { InterpreterUri } from '../../common/types';
import { isResource } from '../../common/utils/misc';
import { getInterpreterHash } from '../../pythonEnvironments/info/interpreter';

/**
 * Keep track of the fact that we attempted to install a package into an interpreter.
 * (don't care whether it was successful or not).
 */
export async function trackPackageInstalledIntoInterpreter(
    memento: Memento,
    product: Product,
    interpreter: InterpreterUri
) {
    if (isResource(interpreter)) {
        return;
    }
    const key = `${await getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    await memento.update(key, true);
}
export async function clearInstalledIntoInterpreterMemento(memento: Memento, product: Product, interpreterPath: Uri) {
    const key = `${await getInterpreterHash({ uri: interpreterPath })}#${ProductNames.get(product)}`;
    await memento.update(key, undefined);
}
export async function isModulePresentInEnvironmentCache(
    memento: Memento,
    product: Product,
    interpreter: PythonEnvironment
) {
    const key = `${await getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    return memento.get<boolean>(key, false);
}
