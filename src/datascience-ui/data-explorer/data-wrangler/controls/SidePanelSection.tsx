import * as React from 'react';

interface IProps {
    title: string;
    panel: React.ReactElement;
    collapsed: boolean;
}

interface IState {}

export class SidePanelSection extends React.Component<IProps, IState> {
    render() {
        return (
            <details
                open={this.props.collapsed ? undefined : true}
                className="slicing-control"
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '4px'
                }}
            >
                <summary className="slice-summary">
                    <h3 className="slice-summary-detail">{this.props.title}</h3>
                </summary>
                {this.props.panel}
            </details>
        );
    }
}

export default SidePanelSection;
