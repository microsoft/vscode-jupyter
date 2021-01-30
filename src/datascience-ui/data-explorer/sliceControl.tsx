import * as React from 'react';
import { IGetSliceRequest } from '../../client/datascience/data-viewing/types';

interface ISliceFormProps {
    dataShapeAsArray: number[];
    handleSliceRequest(slice: IGetSliceRequest): void;
}

interface ISliceFormState {
    value: string;
}

export class SliceControl extends React.Component<ISliceFormProps, ISliceFormState> {
    constructor(props: ISliceFormProps) {
        super(props);
        this.state = { value: '[' + this.props.dataShapeAsArray.map(() => ':').join(', ') + ']' };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    public handleChange(event: React.FormEvent<HTMLInputElement>) {
        this.setState({ value: event.currentTarget.value });
    }

    public handleSubmit(event: React.SyntheticEvent) {
        event.preventDefault();
        this.props.handleSliceRequest({ slice: this.state.value, originalShape: this.props.dataShapeAsArray });
    }

    render() {
        return (
            <div className="slice-data-control-container" style={{ display: 'flex', justifyContent: 'space-around' }}>
                <form onSubmit={this.handleSubmit} style={{ alignSelf: 'center' }}>
                    <label>
                        {'Slice data:  '}
                        <input
                            type="text"
                            className="slice-data"
                            value={this.state.value}
                            onChange={this.handleChange}
                            style={{ width: '80px' }}
                        />
                    </label>
                    <input type="submit" value="Slice" />
                </form>
            </div>
        );
    }
}
