import * as React from 'react';
import { getLocString } from '../../../../react-common/locReactSide';
import { inputStyle } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setArgs(args: any): void;
}

interface IState {
    newColumnName: string | undefined;
}

export class RenameColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            newColumnName: ''
        };
        this.props.setArgs({
            newColumnName: ''
        });
    }

    render() {
        return (
            <>
                <span>{getLocString("DataScience.dataWranglerNewName", "New Name")}</span>
                <input
                    value={this.state.newColumnName}
                    onChange={this.handleChange}
                    className={'slice-data'}
                    style={inputStyle}
                    autoComplete="on"
                />
            </>
        );
    }

    private handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ newColumnName: event.currentTarget.value });
        this.props.setArgs({
            newColumnName: event.currentTarget.value
        });
    };
}
