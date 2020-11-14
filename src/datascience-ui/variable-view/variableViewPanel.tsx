// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as React from 'react';
import { connect } from 'react-redux';
import { handleLinkClick } from '../interactive-common/handlers';
import { IMainWithVariables, IStore } from '../interactive-common/redux/store';
import { IVariablePanelProps, VariablePanel } from '../interactive-common/variablePanel';
import { actionCreators } from './redux/actions';

// tslint:disable: no-suspicious-comment
export type IInteractivePanelProps = IMainWithVariables & typeof actionCreators;

function mapStateToProps(state: IStore): IMainWithVariables {
    return { ...state.main, variableState: state.variables };
}

export class VariableViewPanel extends React.Component<IInteractivePanelProps> {
    private renderCount: number = 0;

    constructor(props: IInteractivePanelProps) {
        super(props);
    }

    public componentDidMount() {
        document.addEventListener('click', this.linkClick, true);
        this.props.editorLoaded(); // We don't have an editor, but this is basically the startup command for the webview
    }

    public componentWillUnmount() {
        document.removeEventListener('click', this.linkClick);
        this.props.editorUnmounted();
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

        return (
            <div id="variable-view-main-panel" role="Main" style={dynamicFont}>
                <button onClick={this.props.toggleVariableExplorer}>OPEN</button>
                {this.renderVariablePanel(this.props.baseTheme)}
            </div>
        );
    }

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
            offsetHeight: 0 // No toolbar in variable view panel
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

// Main export, return a redux connected editor
export function getConnectedVariableViewPanel() {
    return connect(mapStateToProps, actionCreators)(VariableViewPanel);
}
