import * as React from 'react';

interface ICellProps {
    data: string;
    selected: boolean;
    first: boolean;
}

export class Cell extends React.PureComponent<ICellProps> {
    public render() {
        const style = {
            color: this.props.selected ? 'green' : 'var(--vscode-editor-foreground)'
        };
        const comma = this.props.first ? undefined : (
            <span style={{ color: 'var(--vscode-editor-foreground)' }}>{', '}</span>
        );
        return (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
                {comma}
                <span style={style}>{this.props.data}</span>
            </div>
        );
    }
}
