import * as React from 'react';

interface IProps {
    submitCommand(data: { command: string; args: any }): void;
}

export class Toolbar extends React.PureComponent<IProps> {
    render() {
        return (
            <div
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    paddingLeft: '5px'
                }}
            >
                <div
                    className="codicon codicon-export codicon-button"
                    onClick={() => this.props.submitCommand({ command: 'export_to_csv', args: null })}
                    title="Export to CSV"
                />
                <div className="codicon codicon-go-to-file codicon-button" title="Open in Python Script" />
                <div className="codicon codicon-notebook codicon-button" title="Open in Notebook" />
                <div
                    className="codicon codicon-window codicon-button"
                    onClick={() => this.props.submitCommand({ command: 'open_interactive_window', args: undefined })}
                    title="Open in Interactive Window"
                />
            </div>
        );
    }
}
