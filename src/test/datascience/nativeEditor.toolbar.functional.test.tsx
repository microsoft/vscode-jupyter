// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { ReactWrapper } from 'enzyme';
import * as React from 'react';
import * as sinon from 'sinon';
import { PYTHON_LANGUAGE } from '../../client/common/constants';
import { getNamesAndValues } from '../../client/common/utils/enum';
import { ServerStatus } from '../../datascience-ui/interactive-common/mainState';
import { TrustMessage } from '../../datascience-ui/interactive-common/trustMessage';
import { INativeEditorToolbarProps, Toolbar } from '../../datascience-ui/native-editor/toolbar';
import { ImageButton } from '../../datascience-ui/react-common/imageButton';
import { noop } from '../core';
import { mountComponent } from './testHelpers';

// tslint:disable: no-any use-default-type-parameter

enum Button {
    RunAll = 0,
    RunAbove = 1,
    RunBelow = 2,
    RestartKernel = 3,
    InterruptKernel = 4,
    AddCell = 5,
    ClearAllOutput = 6,
    VariableExplorer = 7,
    Save = 8,
    Export = 9
}
const allowList: Button[] = []; // List of buttons to be enabled while a notebook is untrusted

suite('DataScience Native Toolbar', () => {
    const noopAny: any = noop;
    let props: INativeEditorToolbarProps;
    let wrapper: ReactWrapper<any, Readonly<{}>, React.Component>;
    setup(() => {
        props = {
            baseTheme: '',
            busy: false,
            cellCount: 0,
            dirty: false,
            export: sinon.stub(),
            exportAs: sinon.stub(),
            font: { family: '', size: 1 },
            interruptKernel: sinon.stub(),
            kernel: {
                kernelName: '',
                jupyterServerStatus: ServerStatus.Busy,
                serverName: '',
                language: PYTHON_LANGUAGE
            },
            restartKernel: sinon.stub(),
            selectKernel: noopAny,
            selectServer: noopAny,
            addCell: sinon.stub(),
            clearAllOutputs: sinon.stub(),
            executeAbove: sinon.stub(),
            executeAllCells: sinon.stub(),
            executeCellAndBelow: sinon.stub(),
            save: sinon.stub(),
            selectionFocusedInfo: {},
            sendCommand: noopAny,
            toggleVariableExplorer: sinon.stub(),
            setVariableExplorerHeight: sinon.stub(),
            launchNotebookTrustPrompt: sinon.stub(),
            variablesVisible: false,
            isNotebookTrusted: true
        };
    });
    function mountToolbar() {
        wrapper = mountComponent('native', <Toolbar {...props}></Toolbar>);
    }
    function getToolbarButton(button: Button) {
        return wrapper.find(ImageButton).at(button);
    }
    function getTrustMessage() {
        return wrapper.find(TrustMessage);
    }
    function clickTrustMessage() {
        const handler = getTrustMessage().props().launchNotebookTrustPrompt;
        if (handler) {
            handler();
        }
    }
    function assertEnabled(button: Button) {
        assert.isFalse(getToolbarButton(button).props().disabled);
    }
    function assertDisabled(button: Button) {
        assert.isTrue(getToolbarButton(button).props().disabled);
    }
    function clickButton(button: Button) {
        const handler = getToolbarButton(button).props().onClick;
        if (handler) {
            handler();
        }
    }
    suite('Run All', () => {
        test('When not busy it is enabled', () => {
            props.busy = false;
            mountToolbar();
            assertEnabled(Button.RunAll);
        });
        test('When busy it is disabled', () => {
            props.busy = true;
            mountToolbar();
            assertDisabled(Button.RunAll);
        });
        test('When clicked dispatches executeAllCells', () => {
            mountToolbar();
            clickButton(Button.RunAll);
            assert.isTrue(((props.executeAllCells as any) as sinon.SinonStub).calledOnce);
        });
    });
    suite('Run Above', () => {
        test('If not busy and there are no selected cells, then disabled', () => {
            props.selectionFocusedInfo.selectedCellIndex = undefined;
            props.busy = false;
            mountToolbar();
            assertDisabled(Button.RunAbove);
        });
        test('If not busy and selected cell is first cell, then disabled', () => {
            props.selectionFocusedInfo.selectedCellIndex = 0;
            props.busy = false;
            mountToolbar();
            assertDisabled(Button.RunAbove);
        });
        test('If not busy and selected cell is second cell, then enabled', () => {
            props.selectionFocusedInfo.selectedCellIndex = 1;
            props.busy = false;
            mountToolbar();
            assertEnabled(Button.RunAbove);
        });
        test('When busy it is disabled', () => {
            props.busy = true;
            mountToolbar();
            assertDisabled(Button.RunAbove);
        });
        test('When clicked dispatches executeAbove', () => {
            props.selectionFocusedInfo.selectedCellId = 'My_Selected_CellId';
            props.selectionFocusedInfo.selectedCellIndex = 5;
            mountToolbar();
            clickButton(Button.RunAbove);
            assert.isTrue(((props.executeAbove as any) as sinon.SinonStub).calledOnce);
            assert.equal(((props.executeAbove as any) as sinon.SinonStub).firstCall.args[0], 'My_Selected_CellId');
        });
    });
    suite('Run Below', () => {
        test('If not busy and there are no selected cells, then disabled', () => {
            props.selectionFocusedInfo.selectedCellIndex = undefined;
            props.selectionFocusedInfo.selectedCellId = undefined;
            props.busy = false;
            mountToolbar();
            assertDisabled(Button.RunBelow);
        });
        test('If not busy and selected cell is last cell, then disabled', () => {
            props.selectionFocusedInfo.selectedCellIndex = undefined;
            props.selectionFocusedInfo.selectedCellIndex = 10;
            props.cellCount = 11;
            props.busy = false;
            mountToolbar();
            assertDisabled(Button.RunBelow);
        });
        test('If not busy and selected cell is other than last cell, then enabled', () => {
            props.selectionFocusedInfo.selectedCellId = 'My_Selected_CellId';
            props.selectionFocusedInfo.selectedCellIndex = 5;
            props.cellCount = 11;
            props.busy = false;
            mountToolbar();
            assertEnabled(Button.RunBelow);
        });
        test('When busy it is disabled', () => {
            props.busy = true;
            mountToolbar();
            assertDisabled(Button.RunBelow);
        });
        test('When clicked dispatches executeBelow', () => {
            props.selectionFocusedInfo.selectedCellId = 'My_Selected_CellId';
            props.selectionFocusedInfo.selectedCellIndex = 5;
            props.cellCount = 11;
            mountToolbar();
            clickButton(Button.RunBelow);
            assert.isTrue(((props.executeCellAndBelow as any) as sinon.SinonStub).calledOnce);
            assert.equal(
                ((props.executeCellAndBelow as any) as sinon.SinonStub).firstCall.args[0],
                'My_Selected_CellId'
            );
        });
    });
    suite('Restart & Interrupt Kernel', () => {
        getNamesAndValues<ServerStatus>(ServerStatus).forEach((status) => {
            // Should always be disabled if busy.
            if (status.name === ServerStatus.NotStarted) {
                // Should be disabled if not busy and status === 'Not Started'.
                test(`If Kernel status is ${ServerStatus.NotStarted} and not busy, both are disabled`, () => {
                    props.kernel.jupyterServerStatus = ServerStatus.NotStarted;
                    props.busy = false;
                    mountToolbar();
                    assertDisabled(Button.RestartKernel);
                    assertDisabled(Button.InterruptKernel);
                });
            } else {
                // Should be enabled if busy and status != 'Not Started'.
                test(`If Kernel status is ${status.name}, both are enabled`, () => {
                    props.kernel.jupyterServerStatus = status.name as any;
                    props.busy = true;
                    mountToolbar();
                    assertEnabled(Button.RestartKernel);
                    assertEnabled(Button.InterruptKernel);
                });
            }
        });
        test('When clicked dispatches restartKernel', () => {
            mountToolbar();
            clickButton(Button.RestartKernel);
            assert.isTrue(((props.restartKernel as any) as sinon.SinonStub).calledOnce);
        });
        test('When clicked dispatches interruptKernel', () => {
            mountToolbar();
            clickButton(Button.InterruptKernel);
            assert.isTrue(((props.interruptKernel as any) as sinon.SinonStub).calledOnce);
        });
    });
    suite('When trusted', () => {
        test('Trust message shows "Trusted"', () => {
            mountToolbar();
            const message = getTrustMessage();
            assert.equal(message.text(), 'Trusted');
        });
        test('Clicking trust message does nothing', () => {
            mountToolbar();
            clickTrustMessage();
            assert.isTrue(((props.launchNotebookTrustPrompt as any) as sinon.SinonStub).notCalled);
        });
    });
    suite('When untrusted', () => {
        setup(() => {
            props = {
                baseTheme: '',
                busy: false,
                cellCount: 0,
                dirty: false,
                export: sinon.stub(),
                exportAs: sinon.stub(),
                font: { family: '', size: 1 },
                interruptKernel: sinon.stub(),
                kernel: {
                    kernelName: '',
                    jupyterServerStatus: ServerStatus.Busy,
                    serverName: '',
                    language: PYTHON_LANGUAGE
                },
                restartKernel: sinon.stub(),
                selectKernel: noopAny,
                selectServer: noopAny,
                addCell: sinon.stub(),
                clearAllOutputs: sinon.stub(),
                executeAbove: sinon.stub(),
                executeAllCells: sinon.stub(),
                executeCellAndBelow: sinon.stub(),
                save: sinon.stub(),
                selectionFocusedInfo: {},
                sendCommand: noopAny,
                toggleVariableExplorer: sinon.stub(),
                setVariableExplorerHeight: sinon.stub(),
                launchNotebookTrustPrompt: sinon.stub(),
                variablesVisible: false,
                isNotebookTrusted: false
            };
        });
        test('All toolbar buttons are disabled unless explicitly added to allowlist', () => {
            mountToolbar();
            const buttons = wrapper.find(ImageButton);
            let index = 0;
            buttons.forEach((_b) => {
                if (!allowList.includes(index)) {
                    assertDisabled(index);
                }
                index += 1;
            });
        });
        test('Trust message shows "Not Trusted"', () => {
            mountToolbar();
            const message = getTrustMessage();
            assert.equal(message.text(), 'Not Trusted');
        });
        test('Clicking trust message dispatches launchNotebookTrustPrompt', () => {
            mountToolbar();
            clickTrustMessage();
            assert.isTrue(((props.launchNotebookTrustPrompt as any) as sinon.SinonStub).calledOnce);
        });
    });
});
