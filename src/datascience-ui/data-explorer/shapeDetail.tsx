import * as React from 'react';
import { Cell } from './cell';

interface IShapeDetailProps {
    highlightedIndex: number;
    shapeComponents: number[] | undefined;
}

export class ShapeDetail extends React.Component<IShapeDetailProps> {
    public render() {
        if (this.props.shapeComponents) {
            const shape = this.props.shapeComponents.map((component, index) => (
                <Cell
                    data={component.toString()}
                    selected={index === this.props.highlightedIndex}
                    first={index === 0}
                />
            ));
            return (
                <div style={{ display: 'flex', justifyContent: 'center', alignSelf: 'center' }}>
                    <span>(</span>
                    {shape}
                    <span>)</span>
                </div>
            );
        }
        return null;
    }
}

