// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * This module imports the reflect-metadata library which is needed by inversify. It was designed to
 * be imported near the start of all entrypoints that will utilize inversify.
 *
 * Note that this uses require, not import, because reflect-metadata may have been already
 * initialized by another extension running on the same extension host. If that happens, the old
 * metadata state would be clobbered.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((Reflect as any).metadata === undefined) {
    require('reflect-metadata');
}
