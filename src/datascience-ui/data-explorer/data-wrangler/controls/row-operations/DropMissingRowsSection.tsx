import { IDropdownOption } from '@fluentui/react';
import * as React from 'react';
import { buttonStyle } from '../styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {}

export class DropMissingRowsSection extends React.Component<IProps, IState> {
    render() {
        return (
            <button
                onClick={() =>
                    this.props.submitCommand({
                        command: 'dropna',
                        args: { target: 'row' }
                    })
                }
                style={buttonStyle}
            >
                Drop
            </button>
        );
    }
}
