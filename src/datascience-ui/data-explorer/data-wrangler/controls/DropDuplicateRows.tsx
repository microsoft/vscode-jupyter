import { IDropdownOption } from '@fluentui/react';
import * as React from 'react';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {}

export class DropDuplicateRowsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
    }

    render() {
        return (
            <button
                onClick={() =>
                    this.props.submitCommand({
                        command: 'drop_duplicates',
                        args: undefined
                    })
                }
                style={{
                    width: '50px',
                    backgroundColor: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                    margin: '0px',
                    padding: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    height: '26px'
                }}
            >
                Drop
            </button>
        );
    }
}
