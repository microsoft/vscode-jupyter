Time execution of a Python statement or expression  
  
Usage, in line mode:  
  %timeit [-n<N> -r<R> [-t|-c] -q -p<P> -o] statement  
or in cell mode:  
  %%timeit [-n<N> -r<R> [-t|-c] -q -p<P> -o] setup_code  
  code  
  code...  
  
Time execution of a Python statement or expression using the timeit  
module.  This function can be used both as a line and cell magic:  
  
- In line mode you can time a single-line statement (though multiple  
  ones can be chained with using semicolons).  
  
- In cell mode, the statement in the first line is used as setup code  
  (executed but not timed) and the body of the cell is timed.  The cell  
  body has access to any variables created in the setup code.  
  
## Options:  
* -n<N>: execute the given statement <N> times in a loop. If <N> is not  
provided, <N> is determined so as to get sufficient accuracy.  
  
* -r<R>: number of repeats <R>, each consisting of <N> loops, and take the  
average result.  
Default: 7  
  
* -t: use time.time to measure the time, which is the default on Unix.  
This function measures wall time.  
  
* -c: use time.clock to measure the time, which is the default on  
Windows and measures wall time. On Unix, resource.getrusage is used  
instead and returns the CPU user time.  
  
* -p<P>: use a precision of <P> digits to display the timing result.  
Default: 3  
  
* -q: Quiet, do not print result.  
  
* -o: return a TimeitResult that can be stored in a variable to inspect  
    the result in more details.  
  
.. versionchanged:: 7.3  
    User variables are no longer expanded,  
    the magic line is always left unmodified.  
  
## Examples  
```python  
  In [1]: %timeit pass  
  8.26 ns ± 0.12 ns per loop (mean ± std. dev. of 7 runs, 100000000 loops each)  
  
  In [2]: u = None  
  
  In [3]: %timeit u is None  
  29.9 ns ± 0.643 ns per loop (mean ± std. dev. of 7 runs, 10000000 loops each)  
  
  In [4]: %timeit -r 4 u == None  
  
  In [5]: import time  
  
  In [6]: %timeit -n1 time.sleep(2)  
  
The times reported by %timeit will be slightly higher than those  
reported by the timeit.py script when variables are accessed. This is  
due to the fact that %timeit executes the statement in the namespace  
of the shell, compared with timeit.py, which uses a single setup  
statement to import function or create variables. Generally, the bias  
does not matter as long as results from timeit.py are not mixed with  
those from %timeit.  
File:      ~/demo/.venv/lib/python3.11/site-packages/IPython/core/magics/execution.py  
  
```