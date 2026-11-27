// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {} from 'reflect-metadata';

/**
 * This module imports the reflect-metadata library which is needed by inversify. It was designed to
 * be imported near the start of all entrypoints that will utilize inversify.
 *
 * Note that this uses require, not import, because reflect-metadata may have been already
 * initialized by another extension running on the same extension host. If that happens, the old
 * metadata state would be clobbered.
 *
 * reflect-metadata 0.2.x shares a registry of metadata providers across all copies loaded in the same
 * extension host. We load our (patched, see build/ci/postInstall.js) copy unless that registry and the
 * global API already exist, so that our metadata is always written through the shared registry.
 * Otherwise it could be written to an older 0.1.x store that later copies cannot reliably read
 * (https://github.com/microsoft/vscode-jupyter/issues/17578).
 */
if (typeof Reflect.defineMetadata !== 'function' || !(Symbol.for('@reflect-metadata:registry') in Reflect)) {
    require('reflect-metadata');
}
