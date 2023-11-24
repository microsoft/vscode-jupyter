```julia  
axes(A, d)  
```  
  
Return the valid range of indices for array A along dimension d.  
  
See also size, and the manual chapter on arrays with custom indices.  
  
## Examples:  
```julia  
julia> A = fill(1, (5,6,7));  
julia> axes(A, 2)  
Base.OneTo(6)  
```  
## Usage note  
  
  
Each of the indices has to be an AbstractUnitRange{<:Integer}, but at the  
same time can be a type that uses custom indices. So, for example, if you  
need a subset, use generalized indexing constructs like begin/end or  
firstindex/lastindex:  
  
ix = axes(v, 1)  
ix[2:end]          # will work for eg Vector, but may fail in general  
ix[(begin+1):end]  # works for generalized indexes  
  
────────────────────────────────────────────────────────────────────────────  
```julia  
axes(A)  
```  
  
Return the tuple of valid indices for array A.  
  
See also: size, keys, eachindex.  
  
## Examples:  
```julia  
julia> A = fill(1, (5,6,7));  
julia> axes(A)  
(Base.OneTo(5), Base.OneTo(6), Base.OneTo(7))"  
```