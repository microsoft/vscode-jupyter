// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as React from 'react';
import { connect } from 'react-redux';
import { handleLinkClick } from '../interactive-common/handlers';
import { IMainWithVariables, IStore } from '../interactive-common/redux/store';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { IVariablePanelProps, VariablePanel } from '../interactive-common/variablePanel';
import { actionCreators } from './redux/actions';

import './variableViewPanel.css';

/* eslint-disable  */
export type IVariableViewPanelProps = IMainWithVariables & typeof actionCreators;

function mapStateToProps(state: IStore): IMainWithVariables {
    return { ...state.main, variableState: state.variables };
}

// This is the top level UI element for our variable view panel, hosted in a vscode webviewView
// It mimics the structure and state of InteractivePanel to be able to share creation / redux / actions
// with the existing variable panels, but the UI contains only the Variable part of the UI
export class VariableViewPanel extends React.Component<IVariableViewPanelProps> {
    private renderCount: number = 0;
    private resizeTimer?: number;
    private panelRef: React.RefObject<HTMLDivElement>;

    constructor(props: IVariableViewPanelProps) {
        super(props);

        this.panelRef = React.createRef<HTMLDivElement>();
        // For the variable view we want to start toggled open
        this.props.toggleVariableExplorer();
    }

    public componentDidMount() {
        window.addEventListener('resize', this.windowResized);
        document.addEventListener('click', this.linkClick, true);
        this.props.variableViewLoaded();
        this.updateSize(); // Update our initial size after mount
    }

    public componentWillUnmount() {
        window.removeEventListener('resize', this.windowResized);
        document.removeEventListener('click', this.linkClick);
    }

    public render() {
        const dynamicFont: React.CSSProperties = {
            fontSize: this.props.font.size,
            fontFamily: this.props.font.family
        };

        // If in test mode, update our count. Use this to determine how many renders a normal update takes.
        if (this.props.testMode) {
            this.renderCount = this.renderCount + 1;
        }

        // Return our variable panel, we wrap this in one more top level element "variable-view-main-panel" so that
        // we can size and host it differently from the variable panel in the interactive window or native editor
        return (
            <div id="variable-view-main-panel" role="Main" ref={this.panelRef} style={dynamicFont}>
                {this.renderVariablePanel(this.props.baseTheme)}
            </div>
        );
    }

    private windowResized = () => {
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
        }
        this.resizeTimer = window.setTimeout(this.updateSize, 50);
    };

    // When the variable view panel updates size, inform the variable view
    private updateSize = () => {
        if (this.panelRef.current) {
            const newHeight = this.panelRef.current.clientHeight;
            this.props.setVariableViewHeight(newHeight);
        }
    };

    // Render function and variable props are the same as those from InterativePanel to allow us to reuse the same
    // control without alterations
    private renderVariablePanel(baseTheme: string) {
        if (this.props.variableState.visible) {
            const variableProps = this.getVariableProps(baseTheme);
            return <VariablePanel {...variableProps} />;
        }

        return null;
    }

    private getVariableProps = (baseTheme: string): IVariablePanelProps => {
        return {
            gridHeight: this.props.variableState.gridHeight,
            containerHeight: this.props.variableState.containerHeight,
            variables: this.props.variableState.variables,
            debugging: this.props.debugging,
            busy: this.props.busy,
            showDataExplorer: this.props.showDataViewer,
            skipDefault: this.props.skipDefault,
            testMode: this.props.testMode,
            closeVariableExplorer: this.props.toggleVariableExplorer,
            setVariableExplorerHeight: this.props.setVariableExplorerHeight,
            baseTheme: baseTheme,
            pageIn: this.pageInVariableData,
            fontSize: this.props.font.size,
            executionCount: this.props.currentExecutionCount,
            refreshCount: this.props.variableState.refreshCount,
            offsetHeight: 0, // No toolbar in variable view panel
            viewMode: true, // Set that we are in variable view mode
            viewHeight: this.props.variableState.viewHeight // Height to use for variable view mode
        };
    };

    private pageInVariableData = (startIndex: number, pageSize: number) => {
        this.props.getVariableData(
            this.props.currentExecutionCount,
            this.props.variableState.refreshCount,
            startIndex,
            pageSize
        );
    };

    private linkClick = (ev: MouseEvent) => {
        handleLinkClick(ev, this.props.linkClick);
    };
}

// Main export, return a redux connected variable view panel
export function getConnectedVariableViewPanel() {
    return connect(mapStateToProps, actionCreators)(VariableViewPanel);
}
