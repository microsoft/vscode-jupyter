// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as assert from 'assert';
import { ReactWrapper } from 'enzyme';
import * as path from 'path';
import * as React from 'react';
import { Provider } from 'react-redux';
import { EXTENSION_ROOT_DIR } from '../../client/common/constants';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { CommonActionType } from '../../datascience-ui/interactive-common/redux/reducers/types';
import { IKeyboardEvent } from '../../datascience-ui/react-common/event';
import { ImageButton } from '../../datascience-ui/react-common/imageButton';
import { noop } from '../core';
import { DataScienceIocContainer } from './dataScienceIocContainer';
import { IMountedWebView } from './mountedWebView';
import { createInputEvent, createKeyboardEvent } from './reactHelpers';
export * from './testHelpersCore';

/* eslint-disable comma-dangle, @typescript-eslint/no-explicit-any, no-multi-str */
export enum CellInputState {
    Hidden,
    Visible,
    Collapsed,
    Expanded
}

export enum CellPosition {
    First = 'first',
    Last = 'last'
}
export function addMockData(
    ioc: DataScienceIocContainer,
    code: string,
    result: string | number | undefined | string[],
    mimeType?: string | string[],
    cellType?: string,
    traceback?: string[]
) {
    if (ioc.mockJupyter) {
        if (cellType && cellType === 'error') {
            ioc.mockJupyter.addError(code, result ? result.toString() : '', traceback);
        } else {
            if (result) {
                ioc.mockJupyter.addCell(code, result, mimeType);
            } else {
                ioc.mockJupyter.addCell(code);
            }
        }
    }
}

// export function addInputMockData(
//     ioc: DataScienceIocContainer,
//     code: string,
//     result: string | number | undefined,
//     mimeType?: string,
//     cellType?: string
// ) {
//     if (ioc.mockJupyter) {
//         if (cellType && cellType === 'error') {
//             ioc.mockJupyter.addError(code, result ? result.toString() : '');
//         } else {
//             if (result) {
//                 ioc.mockJupyter.addInputCell(code, result, mimeType);
//             } else {
//                 ioc.mockJupyter.addInputCell(code);
//             }
//         }
//     }
// }

// export function addContinuousMockData(
//     ioc: DataScienceIocContainer,
//     code: string,
//     resultGenerator: (c: CancellationToken) => Promise<{ result: string; haveMore: boolean }>
// ) {
//     if (ioc.mockJupyter) {
//         ioc.mockJupyter.addContinuousOutputCell(code, resultGenerator);
//     }
// }

export function verifyServerStatus(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>, statusText: string) {
    wrapper.update();

    const foundResult = wrapper.find('div.kernel-status-server');
    assert.ok(foundResult.length >= 1, "Didn't find server status");
    const html = foundResult.html();
    assert.ok(html.includes(statusText), `${statusText} not found in server status`);
}

/**
 * Creates a keyboard event for a cells.
 *
 * @export
 * @param {(Partial<IKeyboardEvent> & { code: string })} event
 * @returns
 */
export function createKeyboardEventForCell(event: Partial<IKeyboardEvent> & { code: string }) {
    const defaultKeyboardEvent: IKeyboardEvent = {
        altKey: false,
        code: '',
        ctrlKey: false,
        editorInfo: {
            contents: '',
            isDirty: false,
            isFirstLine: false,
            isLastLine: false,
            isSuggesting: false,
            clear: noop
        },
        metaKey: false,
        preventDefault: noop,
        shiftKey: false,
        stopPropagation: noop,
        target: {} as any
    };

    const defaultEditorInfo = defaultKeyboardEvent.editorInfo!;
    const providedEditorInfo = event.editorInfo || {};
    return {
        ...defaultKeyboardEvent,
        ...event,
        editorInfo: {
            ...defaultEditorInfo,
            ...providedEditorInfo
        }
    };
}

export function simulateKey(
    domNode: HTMLTextAreaElement,
    key: string,
    code: string,
    shiftDown?: boolean,
    ctrlKey?: boolean,
    altKey?: boolean,
    metaKey?: boolean
) {
    // Submit a keypress into the textarea. Simulate doesn't work here because the keydown
    // handler is not registered in any react code. It's being handled with DOM events

    // Save current selection start so we move appropriately after the event
    const selectionStart = domNode.selectionStart;

    // According to this:
    // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent#Usage_notes
    // The normal events are
    // 1) keydown
    // 2) keypress
    // 3) keyup
    let event = createKeyboardEvent('keydown', { key, code, shiftKey: shiftDown, ctrlKey, altKey, metaKey });

    // Dispatch. Result can be swallowed. If so skip the next event.
    let result = domNode.dispatchEvent(event);
    if (result) {
        event = createKeyboardEvent('keypress', { key, code, shiftKey: shiftDown, ctrlKey, altKey, metaKey });
        result = domNode.dispatchEvent(event);
        if (result) {
            event = createKeyboardEvent('keyup', { key, code, shiftKey: shiftDown, ctrlKey, altKey, metaKey });
            domNode.dispatchEvent(event);

            // Update our value. This will reset selection to zero.
            const before = domNode.value.slice(0, selectionStart);
            const after = domNode.value.slice(selectionStart);
            const keyText = key;

            if (key === '\b') {
                domNode.value = `${before.slice(0, before.length > 0 ? before.length - 1 : 0)}${after}`;
            } else {
                domNode.value = `${before}${keyText}${after}`;
            }

            // Tell the dom node its selection start has changed. Monaco
            // reads this to determine where the character went.
            domNode.selectionEnd = selectionStart + 1;
            domNode.selectionStart = selectionStart + 1;

            // Dispatch an input event so we update the textarea
            domNode.dispatchEvent(createInputEvent());
        }
    }
}

export async function submitInput(mountedWebView: IMountedWebView, textArea: HTMLTextAreaElement): Promise<void> {
    // Get a render promise with the expected number of renders (how many updates a the shift + enter will cause)
    // Should be 6 - 1 for the shift+enter and 5 for the new cell.
    const renderPromise = mountedWebView.waitForMessage(InteractiveWindowMessages.ExecutionRendered);

    // Submit a keypress into the textarea
    simulateKey(textArea, '\n', 'Enter', true);

    return renderPromise;
}

function enterKey(
    textArea: HTMLTextAreaElement,
    key: string,
    code: string,
    shiftDown?: boolean,
    ctrlKey?: boolean,
    altKey?: boolean,
    metaKey?: boolean
) {
    // Simulate a key press
    simulateKey(textArea, key, code, shiftDown, ctrlKey, altKey, metaKey);
}

export function enterEditorKey(
    editorControl: ReactWrapper<any, Readonly<{}>, React.Component> | undefined,
    keyboardEvent: Partial<IKeyboardEvent> & { code: string }
): HTMLTextAreaElement | null {
    const textArea = getTextArea(editorControl);
    assert.ok(textArea!, 'Cannot find the textarea inside the monaco editor');
    textArea!.focus();

    enterKey(
        textArea!,
        keyboardEvent.code,
        keyboardEvent.code,
        keyboardEvent.shiftKey,
        keyboardEvent.ctrlKey,
        keyboardEvent.altKey,
        keyboardEvent.metaKey
    );

    return textArea;
}

export function typeCode(
    editorControl: ReactWrapper<any, Readonly<{}>, React.Component> | undefined,
    code: string
): HTMLTextAreaElement | null {
    const textArea = getTextArea(editorControl);
    assert.ok(textArea!, 'Cannot find the textarea inside the monaco editor');
    textArea!.focus();

    // Now simulate entering all of the keys
    for (let i = 0; i < code.length; i += 1) {
        let key = code.charAt(i);
        let keyCode = key;
        if (key === '\n') {
            keyCode = 'Enter';
        } else if (key === '\b') {
            keyCode = 'Backspace';
        } else if (key === '\u0046') {
            keyCode = 'Delete';
        }
        enterKey(textArea!, key, keyCode);
    }

    return textArea;
}

function getTextArea(
    editorControl: ReactWrapper<any, Readonly<{}>, React.Component> | undefined
): HTMLTextAreaElement | null {
    // Find the last cell. It should have a monacoEditor object. We need to search
    // through its DOM to find the actual textarea to send input to
    // (we can't actually find it with the enzyme wrappers because they only search
    //  React accessible nodes and the monaco html is not react)
    assert.ok(editorControl, 'Editor not defined in order to type code into');
    let ecDom = editorControl!.getDOMNode();
    if ((ecDom as any).length) {
        ecDom = (ecDom as any)[0];
    }
    assert.ok(ecDom, 'ec DOM object not found');
    return ecDom!.querySelector('.overflow-guard')!.querySelector('textarea');
}

export function findButton(
    wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
    mainClass: React.ComponentClass<any>,
    index: number
): ReactWrapper<any, Readonly<{}>, React.Component> | undefined {
    const mainObj = wrapper.find(mainClass);
    if (mainObj) {
        const buttons = mainObj.find(ImageButton);
        if (buttons) {
            return buttons.at(index);
        }
    }
}

export function getMainPanel<P>(
    wrapper: ReactWrapper<any, Readonly<{}>>,
    mainClass: React.ComponentClass<any>
): P | undefined {
    const mainObj = wrapper.find(mainClass);
    if (mainObj) {
        return (mainObj.instance() as any) as P;
    }

    return undefined;
}

export function escapePath(p: string) {
    return p.replace(/\\/g, '\\\\');
}

export function srcDirectory() {
    return path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');
}

// Open up our variable explorer which also triggers a data fetch
export function openVariableExplorer(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>) {
    const nodes = wrapper.find(Provider);
    if (nodes.length > 0) {
        const store = nodes.at(0).props().store;
        if (store) {
            store.dispatch({ type: CommonActionType.TOGGLE_VARIABLE_EXPLORER });
        }
    }
}

export async function waitForVariablesUpdated(mountedWebView: IMountedWebView, numberOfTimes?: number): Promise<void> {
    return mountedWebView.waitForMessage(InteractiveWindowMessages.VariablesComplete, { numberOfTimes });
}
