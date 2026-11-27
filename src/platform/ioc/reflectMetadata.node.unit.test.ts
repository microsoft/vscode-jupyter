// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs';
import * as path from '../vscode-path/path';
import * as vm from 'vm';

// Simulates the extension host for https://github.com/microsoft/vscode-jupyter/issues/17578
suite('reflect-metadata fallback lookup', () => {
    const reflectJsPath = require.resolve('reflect-metadata');
    const patchedSource = fs.readFileSync(reflectJsPath, 'utf8');
    const marker = '/*! Modified by vscode-jupyter: fall through to fallback provider';

    function readLegacyMetadataAfterThreeCopies(source: string) {
        const context = vm.createContext({});
        // Minimal metadata store matching reflect-metadata 0.1.x, used by another extension before ours loads.
        vm.runInContext(
            `(function () {
                const store = new WeakMap();
                const getMap = (target, key, create) => {
                    let targetMap = store.get(target);
                    if (!targetMap && create) store.set(target, (targetMap = new Map()));
                    let map = targetMap && targetMap.get(key);
                    if (!map && create) targetMap.set(key, (map = new Map()));
                    return map;
                };
                Reflect.defineMetadata = (k, v, t, p) => getMap(t, p, true).set(k, v);
                Reflect.hasOwnMetadata = (k, t, p) => !!getMap(t, p, false)?.has(k);
                Reflect.getOwnMetadata = (k, t, p) => getMap(t, p, false)?.get(k);
                Reflect.getOwnMetadataKeys = (t, p) => [...(getMap(t, p, false)?.keys() ?? [])];
                Reflect.deleteMetadata = (k, t, p) => !!getMap(t, p, false)?.delete(k);
                globalThis.LegacyService = class LegacyService {};
                Reflect.defineMetadata('design:paramtypes', 'legacy', LegacyService);
                globalThis.legacyGetOwnMetadata = Reflect.getOwnMetadata;
            })();`,
            context
        );
        // Three extensions each load their own copy of reflect-metadata 0.2.x.
        for (let i = 0; i < 3; i++) {
            vm.runInContext(`(function () {\n${source}\n})();`, context);
        }
        return vm.runInContext(
            `({
                replaced: Reflect.getOwnMetadata !== legacyGetOwnMetadata,
                hasRegistry: Symbol.for('@reflect-metadata:registry') in Reflect,
                value: Reflect.getOwnMetadata('design:paramtypes', LegacyService)
            })`,
            context
        ) as { replaced: boolean; hasRegistry: boolean; value: unknown };
    }

    test('Installed reflect-metadata is the patched version', () => {
        const { version } = JSON.parse(fs.readFileSync(path.join(path.dirname(reflectJsPath), 'package.json'), 'utf8'));
        assert.strictEqual(version, '0.2.2', 'Update or remove the patch in build/ci/postInstall.js');
        assert.include(patchedSource, marker, 'Run `npm run postinstall` to patch reflect-metadata');
    });
    test('Unpatched reflect-metadata loses metadata from an older store', () => {
        // Reverse the postinstall patch to recreate the published 0.2.2 source.
        const unpatchedSource = patchedSource.replace(
            /[ \t]*\/\*! Modified by vscode-jupyter[^\n]*\n([ \t]*)break;/,
            '$1return undefined;'
        );
        assert.notStrictEqual(unpatchedSource, patchedSource);

        const result = readLegacyMetadataAfterThreeCopies(unpatchedSource);

        assert.isTrue(result.replaced);
        assert.isTrue(result.hasRegistry);
        assert.isUndefined(result.value);
    });
    test('Patched reflect-metadata reads metadata from an older store', () => {
        const hostGetOwnMetadata = Reflect.getOwnMetadata;

        const result = readLegacyMetadataAfterThreeCopies(patchedSource);

        assert.isTrue(result.replaced);
        assert.isTrue(result.hasRegistry);
        assert.strictEqual(result.value, 'legacy');
        assert.strictEqual(Reflect.getOwnMetadata, hostGetOwnMetadata);
    });
});
