One-dimensional ndarray with axis labels (including time series).  
  
Labels need not be unique but must be a hashable type. The object  
supports both integer- and label-based indexing and provides a host of  
methods for performing operations involving the index. Statistical  
methods from ndarray have been overridden to automatically exclude  
missing data (currently represented as NaN).  
  
Operations between Series (+, -, /, \\*, \\*\\*) align values based on their  
associated index values-- they need not be the same length. The result  
index will be the sorted union of the two indexes.  
  
## Parameters  
* data : array-like, Iterable, dict, or scalar value  
    Contains data stored in Series. If data is a dict, argument order is  
    maintained.  
* index : array-like or Index (1d)  
    Values must be hashable and have the same length as `data`.  
    Non-unique index values are allowed. Will default to  
    RangeIndex (0, 1, 2, ..., n) if not provided. If data is dict-like  
    and index is None, then the keys in the data are used as the index. If the  
    index is not None, the resulting Series is reindexed with the index values.  
* dtype : str, numpy.dtype, or ExtensionDtype, optional  
    Data type for the output Series. If not specified, this will be  
    inferred from `data`.  
    See the :ref:`user guide <basics.dtypes>` for more usages.  
* name : Hashable, default None  
    The name to give to the Series.  
* copy : bool, default False  
    Copy input data. Only affects Series or 1d ndarray input. See examples.  
  
## Notes  
Please reference the :ref:`User Guide <basics.series>` for more information.  
  
## Examples  
```python  
Constructing Series from a dictionary with an Index specified  
  
>>> d = {'a': 1, 'b': 2, 'c': 3}  
>>> ser = pd.Series(data=d, index=['a', 'b', 'c'])  
>>> ser  
a   1  
b   2  
c   3  
dtype: int64  
  
The keys of the dictionary match with the Index values, hence the Index  
values have no effect.  
  
>>> d = {'a': 1, 'b': 2, 'c': 3}  
>>> ser = pd.Series(data=d, index=['x', 'y', 'z'])  
>>> ser  
x   NaN  
y   NaN  
z   NaN  
dtype: float64  
  
Note that the Index is first build with the keys from the dictionary.  
After this the Series is reindexed with the given Index values, hence we  
get all NaN as a result.  
  
Constructing Series from a list with `copy=False`.  
  
>>> r = [1, 2]  
>>> ser = pd.Series(r, copy=False)  
>>> ser.iloc[0] = 999  
>>> r  
[1, 2]  
>>> ser  
0    999  
1      2  
dtype: int64  
  
Due to input data type the Series has a `copy` of  
the original data even though `copy=False`, so  
the data is unchanged.  
  
Constructing Series from a 1d ndarray with `copy=False`.  
  
>>> r = np.array([1, 2])  
>>> ser = pd.Series(r, copy=False)  
>>> ser.iloc[0] = 999  
>>> r  
array([999,   2])  
>>> ser  
0    999  
1      2  
dtype: int64  
  
Due to input data type the Series has a `view` on  
the original data, so  
the data is changed as well.  
  
```