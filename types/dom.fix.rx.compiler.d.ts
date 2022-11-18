// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * These are fake dom type definitions that rxjs depends on.
 * Another solution is to add the 'dom' lib to tsconfig, but that's even worse.
 * We don't need dom, as the extension does nothing with the dom (dom = HTML entities and the like).
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface EventTarget {}
interface NodeList {}
interface HTMLCollection {}
interface XMLHttpRequest {}
interface Event {}
interface MessageEvent {}
interface CloseEvent {}
interface WebSocket {}
