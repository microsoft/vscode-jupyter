// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IObservable<T, TChange = unknown> {
	/**
	 * Returns the current value.
	 *
	 * Calls {@link IObserver.handleChange} if the observable notices that the value changed.
	 * Must not be called from {@link IObserver.handleChange}!
	 */
	get(): T;

	/**
	 * Forces the observable to check for and report changes.
	 *
	 * Has the same effect as calling {@link IObservable.get}, but does not force the observable
	 * to actually construct the value, e.g. if change deltas are used.
	 * Calls {@link IObserver.handleChange} if the observable notices that the value changed.
	 * Must not be called from {@link IObserver.handleChange}!
	 */
	reportChanges(): void;

	/**
	 * Adds the observer to the set of subscribed observers.
	 * This method is idempotent.
	 */
	addObserver(observer: IObserver): void;

	/**
	 * Removes the observer from the set of subscribed observers.
	 * This method is idempotent.
	 */
	removeObserver(observer: IObserver): void;

	/**
	 * Reads the current value and subscribes to this observable.
	 *
	 * Just calls {@link IReader.readObservable} if a reader is given, otherwise {@link IObservable.get}
	 * (see {@link ConvenientObservable.read}).
	 */
	read(reader: IReader | undefined): T;

	/**
	 * Creates a derived observable that depends on this observable.
	 * Use the reader to read other observables
	 * (see {@link ConvenientObservable.map}).
	 */
	map<TNew>(fn: (value: T, reader: IReader) => TNew): IObservable<TNew>;

	/**
	 * A human-readable name for debugging purposes.
	 */
	readonly debugName: string;

	/**
	 * This property captures the type of the change object. Do not use it at runtime!
	 */
	readonly TChange: TChange;
}

export interface IReader {
	/**
	 * Reads the value of an observable and subscribes to it.
	 */
	readObservable<T>(observable: IObservable<T, any
        >): T;
}

/**
 * Represents an observer that can be subscribed to an observable.
 *
 * If an observer is subscribed to an observable and that observable didn't signal
 * a change through one of the observer methods, the observer can assume that the
 * observable didn't change.
 * If an observable reported a possible change, {@link IObservable.reportChanges} forces
 * the observable to report an actual change if there was one.
 */
export interface IObserver {
	/**
	 * Signals that the given observable might have changed and a transaction potentially modifying that observable started.
	 * Before the given observable can call this method again, is must call {@link IObserver.endUpdate}.
	 *
	 * The method {@link IObservable.reportChanges} can be used to force the observable to report the changes.
	 */
	beginUpdate<T>(observable: IObservable<T>): void;

	/**
	 * Signals that the transaction that potentially modified the given observable ended.
	 */
	endUpdate<T>(observable: IObservable<T>): void;

	/**
	 * Signals that the given observable might have changed.
	 * The method {@link IObservable.reportChanges} can be used to force the observable to report the changes.
	 *
	 * Implementations must not call into other observables, as they might not have received this event yet!
	 * The change should be processed lazily or in {@link IObserver.endUpdate}.
	 */
	handlePossibleChange<T>(observable: IObservable<T>): void;

	/**
	 * Signals that the given observable changed.
	 *
	 * Implementations must not call into other observables, as they might not have received this event yet!
	 * The change should be processed lazily or in {@link IObserver.endUpdate}.
	 */
	handleChange<T, TChange>(observable: IObservable<T, TChange>, change: TChange): void;
}

export interface ISettable<T, TChange = void> {
	set(value: T, transaction: ITransaction | undefined, change: TChange): void;
}

export interface ITransaction {
	/**
	 * Calls {@link Observer.beginUpdate} immediately
	 * and {@link Observer.endUpdate} when the transaction ends.
	 */
	updateObserver(observer: IObserver, observable: IObservable<any, any>): void;
}
