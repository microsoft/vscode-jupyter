```julia  
abs(x)  
```  
  
The absolute value of x.  
  
When abs is applied to signed integers, overflow may occur, resulting in the  
return of a negative value. This overflow occurs only when abs is applied to  
the minimum representable value of a signed integer. That is, when x ==  
typemin(typeof(x)), abs(x) == x < 0, not -x as might be expected.  
  
See also: abs2, unsigned, sign.  
  
## Examples:  
```julia  
julia> abs(-3)  
3  
julia> abs(1 + im)  
1.4142135623730951  
julia> abs(typemin(Int64))  
-9223372036854775808  
```