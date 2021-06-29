import * as React from 'react';
import { DataWranglerCommands } from '../../../../../client/datascience/data-viewing/data-wrangler/types';
import { dropButtonStyle } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {}

export class DropDuplicateRowsSection extends React.Component<IProps, IState> {
    render() {
        return (
            <button
                onClick={() =>
                    this.props.submitCommand({
                        command: DataWranglerCommands.DropDuplicates,
                        args: {}
                    })
                }
                style={dropButtonStyle}
            >
                Drop
            </button>
        );
    }
}
